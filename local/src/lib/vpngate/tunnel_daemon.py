#!/usr/bin/env python3
"""
SubBoost 住宅节点 OpenVPN 隧道与 SOCKS5 代理守护程序

设计要点：
- 每条隧道占用独立的 tunN 设备与一张独立路由表，出站流量靠 SO_BINDTODEVICE 绑定到
  对应 tunN，再配合 `ip rule oif tunN table 10N` 做策略路由。
- VPNGate/SoftEther 这类志愿节点会「静默失效」：OpenVPN 进程还活着、到服务端的 TCP
  依旧 ESTABLISHED，但服务端的转发/NAT 已经废掉，数据包进去出不来。OpenVPN 自带的
  ping 只打到隧道对端，发现不了这种情况，因此 run-proxy 进程内额外跑一个看门狗线程：
  周期性用 SO_BINDTODEVICE 做端到端公网探测，连续失败就原地重建会话。
"""
from __future__ import annotations
import argparse
import base64
from http.client import HTTPException, HTTPResponse
from ipaddress import ip_address
import json
import os
import select
import socket
import ssl
import subprocess
import sys
import threading
import time
from pathlib import Path

DATA_DIR = Path(os.environ.get("SUBSCRIPTION_OUTPUT_DIR", "./data"))
STATE_FILE = DATA_DIR / "vpngate_tunnels.json"
CONFIG_DIR = DATA_DIR / "vpngate_configs"
SETTINGS_FILE = DATA_DIR / "settings.json"
EGRESS_CHECK_HOST = "api.ipify.org"

# 公网可达性探测目标（只做 TCP 握手，验证隧道是否真的能到公网）
HEALTH_PROBE_TARGETS = (("1.1.1.1", 443), ("8.8.8.8", 443), ("223.5.5.5", 443))
HEALTH_PROBE_INTERVAL = 20.0  # 巡检间隔（秒）
HEALTH_PROBE_TIMEOUT = 5.0  # 单次探测超时
HEALTH_FAIL_THRESHOLD = 3  # 连续失败多少次判定隧道已失效
HEAL_MAX_ATTEMPTS = 3  # 单轮自愈最多重建几次
HEAL_RETRY_DELAY = 15.0  # 自愈失败后的退避
DEVICE_READY_TIMEOUT = 45.0  # 等待 TUN 设备就绪的上限（VPNGate 协商常需 5~20s）
EGRESS_READY_TIMEOUT = 30.0  # 等待公网出口验证通过的上限
PEER_PING_INTERVAL = 10  # OpenVPN keepalive: 每 10s 发包
PEER_IDLE_TIMEOUT = 60  # OpenVPN keepalive: 60s 收不到任何包就重启会话
LOG_MAX_BYTES = 2 * 1024 * 1024

# SO_BINDTODEVICE = 25 (Linux)
SO_BINDTODEVICE = 25

_STATE_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# 状态文件读写
# ---------------------------------------------------------------------------
def _load_state_unlocked() -> list[dict]:
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
        except Exception:
            pass
    return []


def _save_state_unlocked(state: list[dict]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    # 同目录临时文件 + replace，避免读到半截 JSON；同盘不会 EXDEV。
    tmp = STATE_FILE.with_name(f"{STATE_FILE.name}.tmp{os.getpid()}")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STATE_FILE)


def load_state() -> list[dict]:
    with _STATE_LOCK:
        return _load_state_unlocked()


def save_state(state: list[dict]) -> None:
    with _STATE_LOCK:
        _save_state_unlocked(state)


def patch_tunnel(node_id: str, patch: dict) -> None:
    """只更新单条隧道的字段，避免不同 writer 互相覆盖整份状态。"""
    if not node_id:
        return
    with _STATE_LOCK:
        state = _load_state_unlocked()
        for item in state:
            if item.get("id") == node_id:
                item.update(patch)
                break
        _save_state_unlocked(state)


def load_settings() -> dict:
    defaults = {
        "publicIp": os.environ.get("DEFAULT_PUBLIC_IP", "47.89.253.12"),
        "socksUser": os.environ.get("VPN_SOCKS_USER", "subboost"),
        "socksPass": os.environ.get("VPN_SOCKS_PASS", "subboost888"),
    }
    if SETTINGS_FILE.exists():
        try:
            saved = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                defaults.update({k: v for k, v in saved.items() if v})
        except Exception:
            pass
    return defaults


# ---------------------------------------------------------------------------
# SOCKS5 中继
# ---------------------------------------------------------------------------
class Socks5Relay:
    """SOCKS5 简易代理服务，支持 RFC 1929 账号密码认证并绑定特定 tun 设备。"""

    def __init__(self, host: str, port: int, tun: str, username: str = "", password: str = ""):
        self.host = host
        self.port = port
        self.tun = tun
        self.username = username
        self.password = password
        self.running = False
        self.server_sock = None
        self.thread = None

    def start(self):
        self.server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server_sock.bind((self.host, self.port))
        self.server_sock.listen(128)
        self.running = True
        self.thread = threading.Thread(target=self._accept_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if self.server_sock:
            try:
                self.server_sock.close()
            except Exception:
                pass

    def _accept_loop(self):
        while self.running:
            try:
                client, _ = self.server_sock.accept()
                threading.Thread(target=self._handle_client, args=(client,), daemon=True).start()
            except Exception:
                break

    def _handle_client(self, client: socket.socket):
        try:
            client.settimeout(15)
            # 1. SOCKS5 握手
            ver_methods = client.recv(2)
            if len(ver_methods) < 2 or ver_methods[0] != 5:
                client.close()
                return
            nmethods = ver_methods[1]
            methods = client.recv(nmethods)

            require_auth = bool(self.username and self.password)

            if require_auth:
                if 2 not in methods:
                    # 客户端不支持账号密码认证
                    client.sendall(b"\x05\xFF")
                    client.close()
                    return
                # 确认使用用户名/密码认证
                client.sendall(b"\x05\x02")

                # RFC 1929 认证协商
                auth_ver = client.recv(1)
                if not auth_ver or auth_ver[0] != 1:
                    client.close()
                    return
                ulen_data = client.recv(1)
                if not ulen_data:
                    client.close()
                    return
                ulen = ulen_data[0]
                uname = client.recv(ulen).decode("utf-8", errors="replace")

                plen_data = client.recv(1)
                if not plen_data:
                    client.close()
                    return
                plen = plen_data[0]
                passwd = client.recv(plen).decode("utf-8", errors="replace")

                if uname != self.username or passwd != self.password:
                    client.sendall(b"\x01\x01")  # 失败
                    client.close()
                    return
                client.sendall(b"\x01\x00")  # 认证成功
            else:
                if 0 not in methods:
                    client.sendall(b"\x05\xFF")
                    client.close()
                    return
                client.sendall(b"\x05\x00")  # 无需认证

            # 2. 请求阶段
            req = client.recv(4)
            if len(req) < 4 or req[0] != 5 or req[1] != 1:  # 仅支持 CONNECT (0x01)
                client.sendall(b"\x05\x07\x00\x01\x00\x00\x00\x00\x00\x00")
                client.close()
                return

            atyp = req[3]
            dest_host = ""
            if atyp == 1:  # IPv4
                dest_host = socket.inet_ntoa(client.recv(4))
            elif atyp == 3:  # 域名
                domain_len = client.recv(1)[0]
                dest_host = client.recv(domain_len).decode("utf-8", errors="replace")
            elif atyp == 4:  # IPv6
                dest_host = socket.inet_ntop(socket.AF_INET6, client.recv(16))
            else:
                client.close()
                return

            dest_port = int.from_bytes(client.recv(2), "big")

            # 3. 建立出站连接并绑定到指定 tun 设备
            remote = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            remote.settimeout(10)
            if self.tun and not bind_tun_device(remote, self.tun):
                # 绑不上隧道设备时绝不能继续，否则流量会从 VPS 自己的出口泄漏出去
                try:
                    client.sendall(b"\x05\x05\x00\x01\x00\x00\x00\x00\x00\x00")
                except Exception:
                    pass
                remote.close()
                return

            try:
                remote.connect((dest_host, dest_port))
            except Exception:
                # 隧道不可用时明确回 SOCKS5 错误码，避免客户端只能看到「莫名超时」
                try:
                    client.sendall(b"\x05\x05\x00\x01\x00\x00\x00\x00\x00\x00")
                except Exception:
                    pass
                remote.close()
                return

            # 响应成功
            client.sendall(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00")

            # 4. 双向中继
            self._relay(client, remote)
        except Exception:
            pass
        finally:
            try:
                client.close()
            except Exception:
                pass

    def _relay(self, left: socket.socket, right: socket.socket):
        sockets = [left, right]
        while self.running:
            try:
                r, _, e = select.select(sockets, [], sockets, 60)
                if e or not r:
                    break
                for s in r:
                    data = s.recv(32768)
                    if not data:
                        return
                    peer = right if s is left else left
                    peer.sendall(data)
            except Exception:
                break


# ---------------------------------------------------------------------------
# 网络辅助
# ---------------------------------------------------------------------------
def run_cmd(cmd: str) -> tuple[int, str]:
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return p.returncode, (p.stdout + "\n" + p.stderr).strip()


def bind_tun_device(sock: socket.socket, tun_name: str) -> bool:
    """把 socket 绑定到指定 tun 设备。

    必须严格判断成败：一旦绑定失败（设备不存在等）却继续连接，流量会从 VPS 的默认出口
    发出去，既会造成住宅 IP 泄漏，也会让健康探测误判为「隧道正常」。
    """
    if not tun_name:
        return False
    try:
        sock.setsockopt(socket.SOL_SOCKET, SO_BINDTODEVICE, tun_name.encode("utf-8"))
        return True
    except OSError:
        return False


def device_exists(tun_name: str) -> bool:
    return run_cmd(f"ip link show {tun_name}")[0] == 0


def wait_for_device(tun_name: str, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if device_exists(tun_name):
            return True
        time.sleep(0.5)
    return False


def probe_via_tun(tun_name: str, timeout: float = HEALTH_PROBE_TIMEOUT) -> bool:
    """绑定 tun 设备做一次 TCP 握手，判断隧道能否真正到达公网。

    OpenVPN 自带的 ping 只打到隧道对端，服务端转发/NAT 挂掉时依旧「健康」，
    所以健康检查必须端到端探测公网；同时绑定失败必须直接判为不健康。
    """
    if not device_exists(tun_name):
        return False
    for host, port in HEALTH_PROBE_TARGETS:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            if not bind_tun_device(sock, tun_name):
                return False
            sock.connect((host, port))
            return True
        except OSError:
            continue
        finally:
            try:
                sock.close()
            except Exception:
                pass
    return False


def apply_policy_routing(tun_name: str, table_id: int) -> None:
    """幂等地重建策略路由，OpenVPN 自行重连后也能补齐。"""
    if not tun_name or not table_id:
        return
    run_cmd(f"ip route replace default dev {tun_name} table {table_id}")
    run_cmd(f"ip rule del oif {tun_name} 2>/dev/null")
    run_cmd(f"ip rule add oif {tun_name} table {table_id} pref {table_id}")


def check_public_egress(tun_name: str) -> str:
    """通过指定 TUN 网卡完成 HTTPS 请求，并返回检测到的公网出口 IP。"""
    try:
        addresses = [
            item
            for item in socket.getaddrinfo(EGRESS_CHECK_HOST, 443, type=socket.SOCK_STREAM)
            if item[0] == socket.AF_INET
        ]
    except OSError as err:
        raise RuntimeError(f"公网出口检查失败：无法解析 {EGRESS_CHECK_HOST}：{err}") from err
    if not addresses:
        raise RuntimeError(f"公网出口检查失败：无法解析 {EGRESS_CHECK_HOST}")

    context = ssl.create_default_context()
    last_error: Exception | None = None
    for attempt in range(3):
        family, socktype, proto, _, address = addresses[attempt % len(addresses)]
        raw = socket.socket(family, socktype, proto)
        secured = None
        response = None
        deadline = time.monotonic() + 5
        try:
            # 绑定 TUN，确保检查流量不能回落到 VPS 默认出口（绑定失败说明隧道已不可用）
            if not bind_tun_device(raw, tun_name):
                raise RuntimeError(f"无法绑定隧道设备 {tun_name}，隧道不可用")
            raw.settimeout(max(0.1, deadline - time.monotonic()))
            raw.connect(address)
            secured = context.wrap_socket(raw, server_hostname=EGRESS_CHECK_HOST)
            secured.settimeout(max(0.1, deadline - time.monotonic()))
            secured.sendall(
                f"GET / HTTP/1.1\r\nHost: {EGRESS_CHECK_HOST}\r\nConnection: close\r\n\r\n".encode()
            )
            response = HTTPResponse(secured)
            response.begin()
            if response.status != 200:
                raise RuntimeError(f"{EGRESS_CHECK_HOST} 返回 HTTP {response.status}")
            exit_ip = ip_address(response.read(64).decode("ascii").strip())
            if not exit_ip.is_global:
                raise RuntimeError(f"出口返回了非公网 IP：{exit_ip}")
            return str(exit_ip)
        except (OSError, HTTPException, UnicodeError, ValueError, RuntimeError) as err:
            last_error = err
        finally:
            if response is not None:
                response.close()
            (secured or raw).close()
        if attempt < 2:
            time.sleep(1)

    raise RuntimeError(f"住宅隧道无法访问公网（{EGRESS_CHECK_HOST}）：{last_error}")


# ---------------------------------------------------------------------------
# OpenVPN 生命周期
# ---------------------------------------------------------------------------
def openvpn_log_path(tun_name: str) -> Path:
    return CONFIG_DIR / f"{tun_name}.log"


def truncate_if_too_large(path: Path) -> None:
    try:
        if path.exists() and path.stat().st_size > LOG_MAX_BYTES:
            path.unlink()
    except OSError:
        pass


def kill_openvpn(tun_name: str) -> None:
    """只杀该隧道对应的 openvpn 进程。

    必须用 `^openvpn ...` 锚定并带上 `--config`：轮询用的模式如果不加限定，
    会连带把 run-proxy 中继进程（同一个守护程序、参数里也含隧道名）一起杀掉，
    看门狗等于自杀，自愈就永远不会发生。
    """
    if not tun_name:
        return
    run_cmd(f"pkill -f '^openvpn --config .*vpngate_configs/{tun_name}\\.ovpn'")


def clear_tunnel_network(tun_name: str, table_id: int) -> None:
    if not tun_name:
        return
    run_cmd(f"ip rule del oif {tun_name} 2>/dev/null")
    if table_id:
        run_cmd(f"ip route flush table {table_id} 2>/dev/null")
    run_cmd(f"ip link del {tun_name} 2>/dev/null")


def start_openvpn(ovpn_path: Path, tun_name: str) -> tuple[bool, str]:
    log_path = openvpn_log_path(tun_name)
    truncate_if_too_large(log_path)
    cmd = f"openvpn --config {ovpn_path} --daemon ovpn_{tun_name} --log-append {log_path}"
    rc, out = run_cmd(cmd)
    if rc != 0:
        return False, f"OpenVPN 启动失败: {out}"
    return True, ""


def wait_for_egress(tun_name: str, timeout: float) -> tuple[str, str]:
    """等到隧道真的能出公网；返回 (出口 IP, 最后一次错误)。"""
    deadline = time.monotonic() + timeout
    last_error = ""
    while time.monotonic() < deadline:
        if probe_via_tun(tun_name):
            try:
                return check_public_egress(tun_name), ""
            except Exception as err:  # noqa: BLE001
                last_error = str(err)
        time.sleep(1.5)
    return "", last_error or "隧道无法访问公网"


def write_ovpn_file(raw_ovpn: str, tun_name: str, index: int) -> Path:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    cleaned = []
    # 这些参数由守护程序统一接管，避免节点自带配置覆盖策略路由与生命周期管理
    drop_prefixes = (
        "dev ", "dev-", "route ", "redirect-gateway", "ifconfig",
        "up ", "down ", "script-security", "auth-user-pass", "auth-nocache",
        "persist-tun", "keepalive", "ping ", "ping-restart", "ping-exit",
        "verb ", "mute ", "log ", "status ", "writepid", "daemon",
    )
    for ln in raw_ovpn.splitlines():
        s = ln.strip()
        if not s or s.startswith("#") or s.startswith(";"):
            cleaned.append(ln)
            continue
        if s.lower().startswith(drop_prefixes):
            continue
        cleaned.append(ln)

    auth_file = CONFIG_DIR / f"auth_{index}.txt"
    auth_file.write_text("vpn\nvpn\n", encoding="utf-8")

    lines = [
        "client",
        f"dev {tun_name}",
        "dev-type tun",
        # 保留 tun 设备，重连时策略路由（table 10N）才不会随设备一起消失
        "persist-tun",
        "auth-nocache",
        f"auth-user-pass {auth_file}",
        "script-security 2",
        "route-nopull",
        # 客户端侧显式补回保活：节点原生配置里的 keepalive 已被上面的 drop_prefixes 剥离
        f"keepalive {PEER_PING_INTERVAL} {PEER_IDLE_TIMEOUT}",
        "verb 2",
    ]
    lines.extend(cleaned)
    ovpn_path = CONFIG_DIR / f"{tun_name}.ovpn"
    ovpn_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return ovpn_path


def launch_proxy(
    node_id: str,
    hostname: str,
    ip: str,
    country: str,
    tun_name: str,
    port: int,
    table_id: int,
    bind_ip: str,
    username: str,
    password: str,
) -> None:
    """拉起 SOCKS5 中继 + 看门狗进程（输出落文件，避免挂住调用方管道）。

    注意：进程参数里不要出现 ovpn 配置文件路径，否则 kill_openvpn 的模式会误杀中继本身。
    """
    run_cmd(f"pkill -f 'run-proxy .*--port {port}'")
    time.sleep(0.3)

    args = [
        sys.executable or "python3",
        str(Path(__file__).resolve()),
        "run-proxy",
        "--bind", bind_ip,
        "--port", str(port),
        "--tun", tun_name,
        "--user", username,
        "--pass", password,
        "--id", node_id,
        "--hostname", hostname,
        "--ip", ip,
        "--country", country,
        "--table-id", str(table_id),
    ]
    log_path = CONFIG_DIR / f"proxy_{tun_name}.log"
    truncate_if_too_large(log_path)
    with open(log_path, "ab") as log_file:
        subprocess.Popen(
            args,
            stdout=log_file,
            stderr=log_file,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )


# ---------------------------------------------------------------------------
# 健康巡检与自愈
# ---------------------------------------------------------------------------
def rebuild_tunnel(tunnel: dict) -> tuple[bool, str]:
    """按已有配置原地重建 OpenVPN 会话，保持 tun 名称 / 端口 / SOCKS5 鉴权不变。"""
    tun_name = str(tunnel.get("tun") or "")
    table_id = int(tunnel.get("tableId") or 0)
    if not tun_name:
        return False, "隧道缺少 tun 名称，无法自动重建"

    ovpn_path = CONFIG_DIR / f"{tun_name}.ovpn"
    if not ovpn_path.exists():
        return False, f"缺少 {ovpn_path.name}，无法自动重建"

    kill_openvpn(tun_name)
    clear_tunnel_network(tun_name, table_id)
    time.sleep(1.0)

    ok, err = start_openvpn(ovpn_path, tun_name)
    if not ok:
        return False, err

    if not wait_for_device(tun_name, DEVICE_READY_TIMEOUT):
        kill_openvpn(tun_name)
        return False, "TUN 设备创建超时，未能连通目标节点"

    apply_policy_routing(tun_name, table_id)

    egress_ip, last_error = wait_for_egress(tun_name, EGRESS_READY_TIMEOUT)
    if not egress_ip:
        kill_openvpn(tun_name)
        clear_tunnel_network(tun_name, table_id)
        return False, last_error
    return True, egress_ip


class TunnelWatchdog(threading.Thread):
    """周期性做端到端公网探测，隧道静默失效时原地重建。"""

    def __init__(self, tunnel: dict):
        super().__init__(daemon=True)
        self.tunnel = tunnel
        self.failures = 0
        self.stopped = threading.Event()

    def _report(self, patch: dict) -> None:
        patch["lastCheckAt"] = int(time.time())
        patch_tunnel(str(self.tunnel.get("id") or ""), patch)

    def run(self) -> None:
        node_id = str(self.tunnel.get("id") or "")
        tun_name = str(self.tunnel.get("tun") or "")
        table_id = int(self.tunnel.get("tableId") or 0)
        if not node_id or not tun_name:
            return

        while not self.stopped.wait(HEALTH_PROBE_INTERVAL):
            if probe_via_tun(tun_name):
                if self.failures:
                    print(f"[watchdog] {tun_name} 已恢复连通", flush=True)
                self.failures = 0
                # 幂等补齐策略路由（OpenVPN 自行重连后设备可能被重建）
                apply_policy_routing(tun_name, table_id)
                self._report({"healthy": True, "lastError": ""})
                continue

            self.failures += 1
            print(
                f"[watchdog] {tun_name} 公网探测失败 ({self.failures}/{HEALTH_FAIL_THRESHOLD})",
                flush=True,
            )
            self._report({"healthy": False, "lastError": "隧道无法访问公网，正在自动重建"})
            if self.failures < HEALTH_FAIL_THRESHOLD:
                continue

            self.failures = 0
            healed = False
            for attempt in range(1, HEAL_MAX_ATTEMPTS + 1):
                print(f"[watchdog] 第 {attempt}/{HEAL_MAX_ATTEMPTS} 次重建 {tun_name}", flush=True)
                ok, detail = rebuild_tunnel(self.tunnel)
                if ok:
                    restarts = int(self.tunnel.get("restarts") or 0) + 1
                    self.tunnel["restarts"] = restarts
                    self.tunnel["egressIp"] = detail
                    self._report({"healthy": True, "egressIp": detail, "lastError": "", "restarts": restarts})
                    print(f"[watchdog] {tun_name} 重建成功，出口 {detail}", flush=True)
                    healed = True
                    break
                print(f"[watchdog] 重建失败: {detail}", flush=True)
                self._report({"healthy": False, "lastError": detail})
                self.stopped.wait(HEAL_RETRY_DELAY)

            if not healed:
                # 保留端口与进程，等下一轮巡检继续尝试；UI 侧会显示为异常
                print(f"[watchdog] {tun_name} 本轮自愈未成功，稍后重试", flush=True)


# ---------------------------------------------------------------------------
# 动作
# ---------------------------------------------------------------------------
def start_tunnel(
    node_id: str,
    hostname: str,
    ip: str,
    country: str,
    port: int,
    ovpn_b64: str,
    bind_ip: str = "0.0.0.0",
    username: str = "",
    password: str = "",
) -> dict:
    settings = load_settings()
    user = username or settings.get("socksUser", "subboost")
    pwd = password or settings.get("socksPass", "subboost888")
    public_ip = settings.get("publicIp", "47.89.253.12")

    state = load_state()
    used_tuns = {item.get("tun") for item in state if item.get("tun")}
    idx = 1
    while f"tun{idx}" in used_tuns:
        idx += 1

    tun_name = f"tun{idx}"
    table_id = 100 + idx

    raw_ovpn = base64.b64decode(ovpn_b64).decode("utf-8", errors="replace")
    ovpn_path = write_ovpn_file(raw_ovpn, tun_name, idx)

    # 清理同名残留后再启动，避免多个 OpenVPN 抢同一个 tun 设备
    kill_openvpn(tun_name)
    clear_tunnel_network(tun_name, table_id)
    time.sleep(0.5)

    ok, err = start_openvpn(ovpn_path, tun_name)
    if not ok:
        return {"success": False, "error": err}

    if not wait_for_device(tun_name, DEVICE_READY_TIMEOUT):
        kill_openvpn(tun_name)
        clear_tunnel_network(tun_name, table_id)
        return {"success": False, "error": "TUN 设备创建超时，未能连通目标节点"}

    apply_policy_routing(tun_name, table_id)

    egress_ip, last_error = wait_for_egress(tun_name, EGRESS_READY_TIMEOUT)
    if not egress_ip:
        kill_openvpn(tun_name)
        clear_tunnel_network(tun_name, table_id)
        return {"success": False, "error": last_error}

    launch_proxy(
        node_id=node_id,
        hostname=hostname,
        ip=ip,
        country=country,
        tun_name=tun_name,
        port=port,
        table_id=table_id,
        bind_ip=bind_ip,
        username=user,
        password=pwd,
    )

    now = int(time.time())
    tunnel_info = {
        "id": node_id,
        "hostname": hostname,
        "ip": ip,
        "country": country,
        "tun": tun_name,
        "port": port,
        "publicIp": public_ip,
        "egressIp": egress_ip,
        "username": user,
        "password": pwd,
        "tableId": table_id,
        "alive": True,
        "healthy": True,
        "lastCheckAt": now,
        "lastError": "",
        "restarts": 0,
        "startTime": now,
    }

    # 更新状态文件
    new_state = [item for item in state if item.get("id") != node_id]
    new_state.append(tunnel_info)
    save_state(new_state)

    return {"success": True, "tunnel": tunnel_info}


def stop_tunnel(node_id: str) -> dict:
    state = load_state()
    target = None
    remaining = []
    for item in state:
        if item.get("id") == node_id:
            target = item
        else:
            remaining.append(item)

    if not target:
        return {"success": False, "error": "未找到指定隧道"}

    tun_name = target.get("tun", "")
    table_id = int(target.get("tableId") or 0)
    port = target.get("port")

    # 停止 OpenVPN 与 SOCKS5 代理（看门狗随代理进程一起退出）
    if tun_name:
        kill_openvpn(tun_name)
        if port:
            run_cmd(f"pkill -f 'run-proxy .*--port {port}'")
        clear_tunnel_network(tun_name, table_id)

    save_state(remaining)
    return {"success": True}


def main():
    parser = argparse.ArgumentParser(description="SubBoost 隧道守护管理")
    subparsers = parser.add_subparsers(dest="action")

    start_p = subparsers.add_parser("start")
    start_p.add_argument("--id", required=True)
    start_p.add_argument("--hostname", required=True)
    start_p.add_argument("--ip", required=True)
    start_p.add_argument("--country", required=True)
    start_p.add_argument("--port", type=int, required=True)
    start_p.add_argument("--ovpn-b64", required=True)
    start_p.add_argument("--bind", default="0.0.0.0")
    start_p.add_argument("--user", default="")
    start_p.add_argument("--pass", dest="passwd", default="")

    stop_p = subparsers.add_parser("stop")
    stop_p.add_argument("--id", required=True)

    subparsers.add_parser("list")

    proxy_p = subparsers.add_parser("run-proxy")
    proxy_p.add_argument("--bind", default="0.0.0.0")
    proxy_p.add_argument("--port", type=int, required=True)
    proxy_p.add_argument("--tun", required=True)
    proxy_p.add_argument("--user", default="")
    proxy_p.add_argument("--pass", dest="passwd", default="")
    # 看门狗所需信息（由 start 传入）
    proxy_p.add_argument("--id", default="")
    proxy_p.add_argument("--hostname", default="")
    proxy_p.add_argument("--ip", default="")
    proxy_p.add_argument("--country", default="")
    proxy_p.add_argument("--table-id", type=int, default=0)

    args = parser.parse_args()

    if args.action == "start":
        res = start_tunnel(
            node_id=args.id,
            hostname=args.hostname,
            ip=args.ip,
            country=args.country,
            port=args.port,
            ovpn_b64=args.ovpn_b64,
            bind_ip=args.bind,
            username=args.user,
            password=args.passwd,
        )
        print(json.dumps(res, ensure_ascii=False))
    elif args.action == "stop":
        res = stop_tunnel(args.id)
        print(json.dumps(res, ensure_ascii=False))
    elif args.action == "list":
        state = load_state()
        print(json.dumps({"success": True, "tunnels": state}, ensure_ascii=False))
    elif args.action == "run-proxy":
        relay = Socks5Relay(
            host=args.bind,
            port=args.port,
            tun=args.tun,
            username=args.user,
            password=args.passwd,
        )
        relay.start()

        if args.id:
            TunnelWatchdog({
                "id": args.id,
                "hostname": args.hostname,
                "ip": args.ip,
                "country": args.country,
                "tun": args.tun,
                "port": args.port,
                "tableId": args.table_id,
            }).start()

        # 保持前台
        while True:
            time.sleep(3600)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

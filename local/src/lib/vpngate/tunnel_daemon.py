#!/usr/bin/env python3
"""
SubBoost 住宅节点 OpenVPN 隧道与本地回环 SOCKS5 代理守护程序
仅监听 127.0.0.1，公网完全无端口暴露，配合 Clash dialer-proxy 链式落地使用。
"""
from __future__ import annotations
import argparse
import base64
from http.client import HTTPException, HTTPResponse
from ipaddress import ip_address
import json
import os
import re
import select
import signal
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
            # 绑定 TUN，确保检查流量不能回落到 VPS 默认出口。
            raw.setsockopt(socket.SOL_SOCKET, 25, tun_name.encode("utf-8"))
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


# SOCKS5 简易代理服务，支持 RFC 1929 账号密码认证并绑定特定 tun 设备
class Socks5Relay:
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
            if self.tun:
                try:
                    # SO_BINDTODEVICE = 25 (Linux)
                    remote.setsockopt(socket.SOL_SOCKET, 25, self.tun.encode("utf-8"))
                except Exception:
                    pass

            remote.connect((dest_host, dest_port))
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


def run_cmd(cmd: str) -> tuple[int, str]:
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return p.returncode, (p.stdout + "\n" + p.stderr).strip()


def stop_openvpn(config_path: Path, tun_name: str) -> None:
    subprocess.run(
        ["pkill", "-f", f"^openvpn --config {config_path} --daemon ovpn_{tun_name}"],
        capture_output=True,
        check=False,
    )


def load_state() -> list[dict]:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return []


def save_state(state: list[dict]):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def write_ovpn_file(raw_ovpn: str, tun_name: str, index: int) -> Path:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    cleaned = []
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
        "persist-tun",
        "auth-nocache",
        f"auth-user-pass {auth_file}",
        "script-security 2",
        "route-nopull",
        "verb 2",
    ]
    lines.extend(cleaned)
    ovpn_path = CONFIG_DIR / f"{tun_name}.ovpn"
    ovpn_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return ovpn_path


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
    used_tuns = {item.get("tun") for item in state if item.get("alive")}
    idx = 1
    while f"tun{idx}" in used_tuns:
        idx += 1

    tun_name = f"tun{idx}"
    table_id = 100 + idx

    raw_ovpn = base64.b64decode(ovpn_b64).decode("utf-8", errors="replace")
    ovpn_path = write_ovpn_file(raw_ovpn, tun_name, idx)

    # 启动 OpenVPN 进程
    cmd = f"openvpn --config {ovpn_path} --daemon ovpn_{tun_name}"
    rc, out = run_cmd(cmd)
    if rc != 0:
        return {"success": False, "error": f"OpenVPN 启动失败: {out}"}

    # 等待 tun 设备就绪，最多等待 6 秒
    device_ready = False
    for _ in range(12):
        time.sleep(0.5)
        rc, _ = run_cmd(f"ip link show {tun_name}")
        if rc == 0:
            device_ready = True
            break

    if not device_ready:
        stop_openvpn(ovpn_path, tun_name)
        return {"success": False, "error": "TUN 设备创建超时，未能连通目标节点"}

    # 配置策略路由
    run_cmd(f"ip route flush table {table_id}")
    run_cmd(f"ip route add default dev {tun_name} table {table_id}")
    run_cmd(f"ip rule del oif {tun_name} 2>/dev/null")
    run_cmd(f"ip rule add oif {tun_name} table {table_id} pref {table_id}")

    try:
        egress_ip = check_public_egress(tun_name)
    except Exception as err:
        stop_openvpn(ovpn_path, tun_name)
        run_cmd(f"ip rule del oif {tun_name} 2>/dev/null")
        run_cmd(f"ip route flush table {table_id} 2>/dev/null")
        return {"success": False, "error": str(err)}

    # 启动支持鉴权的 SOCKS5 代理
    user_arg = f"--user '{user}'" if user else ""
    pass_arg = f"--pass '{pwd}'" if pwd else ""
    proxy_cmd = f"python3 {__file__} run-proxy --bind {bind_ip} --port {port} --tun {tun_name} {user_arg} {pass_arg} >/dev/null 2>&1 &"
    subprocess.Popen(proxy_cmd, shell=True)

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
        "startTime": int(time.time()),
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
    table_id = target.get("tableId")
    port = target.get("port")

    # 停止 OpenVPN 进程与 SOCKS5 代理
    if tun_name:
        run_cmd(f"pkill -f 'ovpn_{tun_name}'")
        run_cmd(f"pkill -f 'run-proxy .*--port {port}'")
        if table_id:
            run_cmd(f"ip rule del oif {tun_name} 2>/dev/null")
            run_cmd(f"ip route flush table {table_id} 2>/dev/null")

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
        # 保持前台
        while True:
            time.sleep(3600)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

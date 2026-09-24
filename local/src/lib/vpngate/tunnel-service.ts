import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { VpngateNode } from "./vpngate-fetcher";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = join(process.cwd(), "src/lib/vpngate/tunnel_daemon.py");
const STATE_FILE = join(process.env.SUBSCRIPTION_OUTPUT_DIR || "./data", "vpngate_tunnels.json");

const SETTINGS_FILE = join(process.env.SUBSCRIPTION_OUTPUT_DIR || "./data", "settings.json");

export type SystemSettings = {
  publicIp: string;
  socksUser: string;
  socksPass: string;
};

export type ActiveTunnel = {
  id: string;
  hostname: string;
  ip: string;
  country: string;
  tun: string;
  port: number;
  publicIp?: string;
  egressIp?: string;
  username?: string;
  password?: string;
  tableId: number;
  alive: boolean;
  startTime: number;
};

const PORT_START = 10001;
const PORT_END = 10008;

/**
 * 读取系统代理与公网设置
 */
export async function getSystemSettings(): Promise<SystemSettings> {
  const defaults: SystemSettings = {
    publicIp: process.env.DEFAULT_PUBLIC_IP || "47.89.253.12",
    socksUser: process.env.VPN_SOCKS_USER || "subboost",
    socksPass: process.env.VPN_SOCKS_PASS || "subboost888",
  };
  try {
    const raw = await readFile(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      publicIp: parsed.publicIp || defaults.publicIp,
      socksUser: parsed.socksUser || defaults.socksUser,
      socksPass: parsed.socksPass || defaults.socksPass,
    };
  } catch {
    return defaults;
  }
}

/**
 * 保存系统代理与公网设置
 */
export async function updateSystemSettings(settings: Partial<SystemSettings>): Promise<SystemSettings> {
  const current = await getSystemSettings();
  const updated: SystemSettings = {
    publicIp: (settings.publicIp || current.publicIp).trim(),
    socksUser: (settings.socksUser ?? current.socksUser).trim(),
    socksPass: (settings.socksPass ?? current.socksPass).trim(),
  };
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(SETTINGS_FILE), { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

/**
 * 获取当前所有活跃隧道列表
 */
export async function listActiveTunnels(): Promise<ActiveTunnel[]> {
  try {
    const content = await readFile(STATE_FILE, "utf-8");
    const list = JSON.parse(content);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * 挑选未占用的回环代理端口 (10001 - 10008)
 */
async function allocateLoopbackPort(): Promise<number> {
  const tunnels = await listActiveTunnels();
  const usedPorts = new Set(tunnels.map((t) => t.port));
  for (let port = PORT_START; port <= PORT_END; port++) {
    if (!usedPorts.has(port)) return port;
  }
  throw new Error(`已达到最大活跃隧道数限制 (${PORT_END - PORT_START + 1} 条)，请先停止不需要的隧道`);
}

/**
 * 启动一条住宅节点隧道
 */
export async function startTunnel(node: VpngateNode): Promise<ActiveTunnel> {
  const port = await allocateLoopbackPort();
  const settings = await getSystemSettings();

  try {
    const { stdout } = await execFileAsync("python3", [
      SCRIPT_PATH,
      "start",
      "--id",
      node.id,
      "--hostname",
      node.hostname,
      "--ip",
      node.ip,
      "--country",
      node.countryShort,
      "--port",
      String(port),
      "--ovpn-b64",
      node.openvpnConfigBase64,
      "--bind",
      "0.0.0.0",
      "--user",
      settings.socksUser,
      "--pass",
      settings.socksPass,
    ]);

    const res = JSON.parse(stdout.trim());
    if (!res.success) {
      throw new Error(res.error || "启动住宅隧道失败");
    }

    return res.tunnel;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`建立隧道失败: ${msg}`);
  }
}

/**
 * 停止并释放指定隧道
 */
export async function stopTunnel(nodeId: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync("python3", [
      SCRIPT_PATH,
      "stop",
      "--id",
      nodeId,
    ]);

    const res = JSON.parse(stdout.trim());
    if (!res.success) {
      throw new Error(res.error || "停止隧道失败");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`停止隧道失败: ${msg}`);
  }
}

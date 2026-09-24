import * as net from "node:net";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type VpngateNode = {
  id: string; // ip:hostname
  hostname: string;
  ip: string;
  countryShort: string;
  countryLong: string;
  ping: number;
  speed: number; // bps
  score: number;
  operator: string;
  message: string;
  ipType: "住宅/家庭宽带" | "教育网" | "机房" | "公共宽带";
  openvpnConfigBase64: string;
  reachable?: boolean;
  latencyMs?: number;
};

const CANDIDATE_SOURCES = [
  { name: "github_mirror", url: "https://baoweise-bot.github.io/aimili-vpngate/vpngate.csv" },
  { name: "github_raw", url: "https://raw.githubusercontent.com/baoweise-bot/aimili-vpngate/main/mirror/vpngate.csv" },
  { name: "official_https", url: "https://www.vpngate.net/api/iphone/" },
  { name: "official_http", url: "http://www.vpngate.net/api/iphone/" },
];

const CACHE_FILE = join(process.env.SUBSCRIPTION_OUTPUT_DIR || "./data", "vpngate_cache.json");
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟缓存

/**
 * 校验返回内容是否为合法的 VPNGate CSV，防止将反爬拦截的 HTML 错误当成 CSV 解析
 */
export function isValidVpngateCsv(text: string): boolean {
  if (!text || text.length < 500) return false;
  if (text.includes("<!DOCTYPE") || text.includes("<html") || text.includes("__VIEWSTATE")) {
    return false;
  }
  return (
    text.includes("OpenVPN_ConfigData_Base64") ||
    text.includes("*vpn_servers") ||
    text.includes("#HostName")
  );
}

/**
 * 推断 IP 类型（优先识别住宅/教育网/家庭宽带）
 */
export function inferIpType(ip: string, operator: string, message: string): VpngateNode["ipType"] {
  const op = (operator || "").toLowerCase();
  const msg = (message || "").toLowerCase();

  // 典型教育网/学术宽带
  if (
    ip.startsWith("219.100.37.") ||
    op.includes("academic") ||
    op.includes("university") ||
    op.includes("campus") ||
    op.includes("college") ||
    msg.includes("academic") ||
    msg.includes("university")
  ) {
    return "教育网";
  }

  // 典型数据中心/机房
  if (
    op.includes("datacenter") ||
    op.includes("hosting") ||
    op.includes("asn") ||
    op.includes("cloud") ||
    op.includes("server")
  ) {
    return "机房";
  }

  // 常见家庭/住宅宽带关键词
  if (
    op.includes("telecom") ||
    op.includes("broadband") ||
    op.includes("home") ||
    op.includes("residential") ||
    op.includes("ftth") ||
    op.includes("cable") ||
    op.includes("dsl") ||
    op.includes("ntt") ||
    op.includes("kddi") ||
    op.includes("softbank") ||
    op.includes("comcast") ||
    op.includes("spectrum") ||
    op.includes("att") ||
    op.includes("verizon")
  ) {
    return "住宅/家庭宽带";
  }

  // VPNGate 志愿者节点默认多为家庭宽带
  return "住宅/家庭宽带";
}

/**
 * 对单个 IP 端口进行 TCP 探活
 */
export function tcpProbe(ip: string, port: number, timeoutMs = 2500): Promise<number | null> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const cleanup = () => {
      if (!settled) {
        settled = true;
        socket.destroy();
      }
    };

    socket.setTimeout(timeoutMs);

    socket.connect(port, ip, () => {
      const rtt = Date.now() - startTime;
      cleanup();
      resolve(rtt);
    });

    socket.on("timeout", () => {
      cleanup();
      resolve(null);
    });

    socket.on("error", () => {
      cleanup();
      resolve(null);
    });
  });
}

/**
 * 解析 VPNGate CSV 格式文本
 */
export function parseVpngateCsv(csvText: string): VpngateNode[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("*"));
  if (lines.length === 0) return [];

  // 跳过表头
  const dataLines = lines[0].startsWith("#") ? lines.slice(1) : lines;
  const nodes: VpngateNode[] = [];

  for (const line of dataLines) {
    const parts = line.split(",");
    if (parts.length < 15) continue;

    const hostname = parts[0].replace(/^#/, "").trim();
    const ip = parts[1].trim();
    if (!ip || !hostname) continue;

    const score = Number.parseInt(parts[2], 10) || 0;
    const ping = Number.parseInt(parts[3], 10) || 0;
    const speed = Number.parseInt(parts[4], 10) || 0;
    const countryLong = parts[5].trim();
    const countryShort = parts[6].trim().toUpperCase();
    const operator = parts[12].trim().slice(0, 80);
    const message = parts[13].trim().slice(0, 120);
    const openvpnConfigBase64 = parts[14].trim();

    if (!openvpnConfigBase64) continue;

    nodes.push({
      id: `${ip}:${hostname}`,
      hostname,
      ip,
      countryShort,
      countryLong,
      ping,
      speed,
      score,
      operator,
      message,
      ipType: inferIpType(ip, operator, message),
      openvpnConfigBase64,
    });
  }

  return nodes;
}

/**
 * 批量探活节点
 */
async function probeNodesConcurrently(nodes: VpngateNode[], concurrency = 15): Promise<VpngateNode[]> {
  const results: VpngateNode[] = [];
  const queue = [...nodes];

  async function worker() {
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) break;

      let rtt = await tcpProbe(node.ip, 443, 2000);
      if (rtt === null) {
        rtt = await tcpProbe(node.ip, 1194, 2000);
      }
      if (rtt === null) {
        rtt = await tcpProbe(node.ip, 80, 2000);
      }

      results.push({
        ...node,
        reachable: rtt !== null,
        latencyMs: rtt !== null ? rtt : undefined,
      });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, nodes.length) }, () => worker());
  await Promise.all(workers);

  return results.sort((a, b) => {
    if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
    return (a.latencyMs || 9999) - (b.latencyMs || 9999);
  });
}

/**
 * 单节点实时快速探活测速
 */
export async function probeSingleNode(ip: string): Promise<{ reachable: boolean; latencyMs?: number }> {
  let rtt = await tcpProbe(ip, 443, 2500);
  if (rtt === null) {
    rtt = await tcpProbe(ip, 1194, 2500);
  }
  if (rtt === null) {
    rtt = await tcpProbe(ip, 80, 2500);
  }
  return {
    reachable: rtt !== null,
    latencyMs: rtt !== null ? rtt : undefined,
  };
}

/**
 * 获取 VPNGate 节点列表（优先缓存，支持强制刷新）
 */
export async function getVpngateNodes(options?: { force?: boolean }): Promise<{
  nodes: VpngateNode[];
  fromCache: boolean;
  timestamp: number;
}> {
  const { force = false } = options || {};

  if (!force) {
    try {
      const cached = JSON.parse(await readFile(CACHE_FILE, "utf-8"));
      if (
        cached &&
        Array.isArray(cached.nodes) &&
        cached.nodes.length > 0 &&
        Date.now() - (cached.timestamp || 0) < CACHE_TTL_MS
      ) {
        return {
          nodes: cached.nodes,
          fromCache: true,
          timestamp: cached.timestamp,
        };
      }
    } catch {
      // 缓存不存在或失效，继续拉取
    }
  }

  let csvText = "";
  for (const src of CANDIDATE_SOURCES) {
    try {
      const res = await fetch(src.url, {
        signal: AbortSignal.timeout(10000),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/plain,text/csv,*/*",
        },
      });
      if (res.ok) {
        const text = await res.text();
        if (isValidVpngateCsv(text)) {
          csvText = text;
          break;
        } else {
          console.warn(`[vpngate] 节点源 ${src.name} 返回非有效 CSV 内容（疑似拦截），尝试下一个源`);
        }
      }
    } catch (err) {
      console.warn(`[vpngate] 节点源 ${src.name} 请求失败:`, err);
    }
  }

  if (!csvText) {
    try {
      const stale = JSON.parse(await readFile(CACHE_FILE, "utf-8"));
      if (stale && Array.isArray(stale.nodes) && stale.nodes.length > 0) {
        return { nodes: stale.nodes, fromCache: true, timestamp: stale.timestamp };
      }
    } catch {}
    throw new Error("无法从 VPNGate 各数据源获取有效节点列表，请稍后重试");
  }

  const parsed = parseVpngateCsv(csvText);
  parsed.sort((a, b) => b.score - a.score || b.speed - a.speed);
  // 对评分最高的前 60 个节点执行主动探活，其余节点全量保留展示
  const topCandidates = parsed.slice(0, 60);
  const remainingCandidates = parsed.slice(60);

  const probedTopNodes = await probeNodesConcurrently(topCandidates, 15);
  const allNodes = [...probedTopNodes, ...remainingCandidates];

  const timestamp = Date.now();
  const payload = { timestamp, nodes: allNodes };

  if (allNodes.length > 0) {
    try {
      await mkdir(join(CACHE_FILE, ".."), { recursive: true });
      await writeFile(CACHE_FILE, JSON.stringify(payload, null, 2), "utf-8");
    } catch (writeErr) {
      console.warn("[vpngate] 写入缓存文件失败:", writeErr);
    }
  }

  return { nodes: allNodes, fromCache: false, timestamp };
}

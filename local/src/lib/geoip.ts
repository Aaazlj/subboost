import { lookup as dnsLookup } from "node:dns/promises";

/**
 * 节点落地国家识别（GeoIP）
 *
 * 节点名称里往往不含任何国家信息（例如 "vl-reality-SukQjX4gYg43K"），
 * 因此「智能重命名」需要通过节点服务器地址（域名 → IP → GeoIP）来判断落地国家。
 */

export type GeoIpResult = {
  host: string;
  ip: string;
  countryCode: string;
  country: string;
  city: string;
  org: string;
  resolved: boolean;
};

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 10000;
const MAX_HOSTS_PER_REQUEST = 300;
const LOOKUP_TIMEOUT_MS = 4500;
const BATCH_SIZE = 100;
const BATCH_CONCURRENCY = 2;

const cache = new Map<string, { expiresAt: number; result: GeoIpResult }>();

function normalizeHost(raw: string): string {
  return (raw || "").trim().replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function isIpLiteral(host: string): boolean {
  if (IPV4_PATTERN.test(host)) return true;
  return host.includes(":");
}

function isPrivateIp(ip: string): boolean {
  if (IPV4_PATTERN.test(ip)) {
    const parts = ip.split(".").map((part) => Number(part));
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    if (parts[0] === 10 || parts[0] === 127) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80")) return true;
  return false;
}

function emptyResult(host: string, ip = ""): GeoIpResult {
  return { host, ip, countryCode: "", country: "", city: "", org: "", resolved: false };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveHostToIp(host: string): Promise<string> {
  if (isIpLiteral(host)) return host;
  try {
    const result = await withTimeout(dnsLookup(host, { family: 4, all: false }), LOOKUP_TIMEOUT_MS);
    if (result && typeof result === "object" && "address" in result) {
      return String((result as { address: string }).address || "");
    }
    if (typeof result === "string") return result;
    return "";
  } catch {
    return "";
  }
}

type IpApiBatchItem = {
  status?: string;
  message?: string;
  country?: string;
  countryCode?: string;
  city?: string;
  org?: string;
  query?: string;
};

const IP_API_FIELDS = "status,message,country,countryCode,city,org,query";

function applyIpApiItem(target: Map<string, Partial<GeoIpResult>>, ip: string, item: IpApiBatchItem): void {
  if (!item || item.status !== "success") return;
  target.set(ip, {
    countryCode: typeof item.countryCode === "string" ? item.countryCode : "",
    country: typeof item.country === "string" ? item.country : "",
    city: typeof item.city === "string" ? item.city : "",
    org: typeof item.org === "string" ? item.org : "",
  });
}

async function queryIpApiBatch(ips: string[]): Promise<Map<string, Partial<GeoIpResult>>> {
  const found = new Map<string, Partial<GeoIpResult>>();
  const chunks: string[][] = [];
  for (let i = 0; i < ips.length; i += BATCH_SIZE) {
    chunks.push(ips.slice(i, i + BATCH_SIZE));
  }

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < chunks.length) {
      const index = cursor;
      cursor += 1;
      const chunk = chunks[index];
      try {
        const response = await fetch(`http://ip-api.com/batch?fields=${IP_API_FIELDS}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chunk),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) continue;
        const payload = (await response.json()) as unknown;
        if (!Array.isArray(payload)) continue;
        payload.forEach((entry, i) => {
          const ip = chunk[i];
          if (!ip) return;
          applyIpApiItem(found, ip, entry as IpApiBatchItem);
        });
      } catch {
        // 忽略单个批次失败，交给兜底单查询处理
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(BATCH_CONCURRENCY, chunks.length) }, () => worker())
  );
  return found;
}

async function queryIpWhoIs(ip: string): Promise<Partial<GeoIpResult> | null> {
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as unknown as Record<string, unknown>;
    if (payload && payload.success === true) {
      return {
        countryCode: typeof payload.country_code === "string" ? payload.country_code : "",
        country: typeof payload.country === "string" ? payload.country : "",
        city: typeof payload.city === "string" ? payload.city : "",
        org:
          typeof payload.connection === "object" && payload.connection
            ? String((payload.connection as Record<string, unknown>).org ?? "")
            : "",
      };
    }
  } catch {
    // 忽略
  }
  return null;
}

async function querySingleFallback(ips: string[]): Promise<Map<string, Partial<GeoIpResult>>> {
  const found = new Map<string, Partial<GeoIpResult>>();
  const CONCURRENCY = 6;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < ips.length) {
      const index = cursor;
      cursor += 1;
      const ip = ips[index];
      const batchResult = await queryIpApiSingle(ip);
      if (batchResult && batchResult.countryCode) {
        found.set(ip, batchResult);
        continue;
      }
      const fallback = await queryIpWhoIs(ip);
      if (fallback && fallback.countryCode) found.set(ip, fallback);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ips.length) }, () => worker()));
  return found;
}

async function queryIpApiSingle(ip: string): Promise<Partial<GeoIpResult> | null> {
  try {
    const response = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${IP_API_FIELDS}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as unknown as IpApiBatchItem;
    if (!payload || payload.status !== "success") return null;
    return {
      countryCode: typeof payload.countryCode === "string" ? payload.countryCode : "",
      country: typeof payload.country === "string" ? payload.country : "",
      city: typeof payload.city === "string" ? payload.city : "",
      org: typeof payload.org === "string" ? payload.org : "",
    };
  } catch {
    return null;
  }
}

function readCache(host: string): GeoIpResult | null {
  const cached = cache.get(host);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    cache.delete(host);
    return null;
  }
  return cached.result;
}

function writeCache(result: GeoIpResult): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [key, value] of cache) {
      if (value.expiresAt < now) cache.delete(key);
    }
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }
  }
  cache.set(result.host, { expiresAt: Date.now() + CACHE_TTL_MS, result });
}

/**
 * 批量查询一批主机（域名或 IP）的落地国家
 */
export async function lookupGeoIp(rawHosts: string[]): Promise<GeoIpResult[]> {
  const hosts = Array.from(
    new Set(
      (Array.isArray(rawHosts) ? rawHosts : [])
        .map(normalizeHost)
        .filter(Boolean)
    )
  ).slice(0, MAX_HOSTS_PER_REQUEST);

  const results = new Map<string, GeoIpResult>();
  const pending: Array<{ host: string; ip: string }> = [];

  for (const host of hosts) {
    const cached = readCache(host);
    if (cached) {
      results.set(host, cached);
      continue;
    }
    if (isIpLiteral(host) && isPrivateIp(host)) {
      const empty = emptyResult(host, host);
      writeCache(empty);
      results.set(host, empty);
      continue;
    }
    pending.push({ host, ip: "" });
  }

  // 并发解析域名
  const DNS_CONCURRENCY = 8;
  let cursor = 0;
  const resolveWorker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const index = cursor;
      cursor += 1;
      const entry = pending[index];
      const ip = await resolveHostToIp(entry.host);
      entry.ip = ip;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(DNS_CONCURRENCY, pending.length) }, () => resolveWorker())
  );

  const resolvable = pending.filter((entry) => entry.ip && !isPrivateIp(entry.ip));
  const ipToEntries = new Map<string, Array<{ host: string; ip: string }>>();
  for (const entry of resolvable) {
    const list = ipToEntries.get(entry.ip) ?? [];
    list.push(entry);
    ipToEntries.set(entry.ip, list);
  }

  const ips = Array.from(ipToEntries.keys());
  const geoByIp = new Map<string, Partial<GeoIpResult>>();

  if (ips.length > 0) {
    const batched = await queryIpApiBatch(ips);
    for (const [ip, value] of batched) geoByIp.set(ip, value);
    const missing = ips.filter((ip) => !geoByIp.has(ip) || !geoByIp.get(ip)?.countryCode);
    if (missing.length > 0) {
      const fallback = await querySingleFallback(missing);
      for (const [ip, value] of fallback) geoByIp.set(ip, value);
    }
  }

  for (const entry of pending) {
    const geo = entry.ip ? geoByIp.get(entry.ip) : undefined;
    const result: GeoIpResult = {
      host: entry.host,
      ip: entry.ip,
      countryCode: geo?.countryCode ?? "",
      country: geo?.country ?? "",
      city: geo?.city ?? "",
      org: geo?.org ?? "",
      resolved: Boolean(geo?.countryCode),
    };
    writeCache(result);
    results.set(entry.host, result);
  }

  return hosts.map((host) => results.get(host) ?? emptyResult(host));
}

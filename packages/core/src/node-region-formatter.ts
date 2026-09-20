/**
 * 节点区域识别与 Emoji 图标/国家名称格式化工具
 */

export interface RegionPresetItem {
  id: string;
  label: string;
  emoji: string;
  keywords: string[];
}

export const EXTENDED_REGION_PRESETS: RegionPresetItem[] = [
  {
    id: "hk",
    label: "香港",
    emoji: "🇭🇰",
    keywords: ["香港", "HK", "Hong Kong", "HongKong", "🇭🇰", "深港", "沪港", "京港", "港"],
  },
  {
    id: "tw",
    label: "台湾",
    emoji: "🇹🇼",
    keywords: ["台湾", "台灣", "TW", "Taiwan", "🇹🇼", "台北", "新北", "台中", "高雄", "台"],
  },
  {
    id: "jp",
    label: "日本",
    emoji: "🇯🇵",
    keywords: ["日本", "JP", "Japan", "🇯🇵", "东京", "東京", "大阪", "埼玉", "福冈"],
  },
  {
    id: "sg",
    label: "新加坡",
    emoji: "🇸🇬",
    keywords: ["新加坡", "SG", "Singapore", "🇸🇬", "狮城", "沪新", "广新"],
  },
  {
    id: "us",
    label: "美国",
    emoji: "🇺🇸",
    keywords: ["美国", "美國", "US", "USA", "United States", "🇺🇸", "洛杉矶", "硅谷", "圣何塞", "西雅图", "芝加哥", "纽约", "达拉斯", "波特兰", "美"],
  },
  {
    id: "kr",
    label: "韩国",
    emoji: "🇰🇷",
    keywords: ["韩国", "韓國", "KR", "Korea", "🇰🇷", "首尔", "韩"],
  },
  {
    id: "uk",
    label: "英国",
    emoji: "🇬🇧",
    keywords: ["英国", "英國", "UK", "GB", "United Kingdom", "Britain", "🇬🇧", "伦敦", "英"],
  },
  {
    id: "de",
    label: "德国",
    emoji: "🇩🇪",
    keywords: ["德国", "德國", "DE", "Germany", "🇩🇪", "法兰克福", "德"],
  },
  {
    id: "fr",
    label: "法国",
    emoji: "🇫🇷",
    keywords: ["法国", "法國", "FR", "France", "🇫🇷", "巴黎", "法"],
  },
  {
    id: "ca",
    label: "加拿大",
    emoji: "🇨🇦",
    keywords: ["加拿大", "CA", "Canada", "🇨🇦", "多伦多", "温哥华", "加"],
  },
  {
    id: "au",
    label: "澳大利亚",
    emoji: "🇦🇺",
    keywords: ["澳大利亚", "澳洲", "AU", "Australia", "🇦🇺", "悉尼", "墨尔本", "澳"],
  },
  {
    id: "ru",
    label: "俄罗斯",
    emoji: "🇷🇺",
    keywords: ["俄罗斯", "俄国", "RU", "Russia", "🇷🇺", "莫斯科", "海参崴", "伯力", "俄"],
  },
  {
    id: "my",
    label: "马来西亚",
    emoji: "🇲🇾",
    keywords: ["马来西亚", "大马", "MY", "Malaysia", "🇲🇾", "吉隆坡"],
  },
  {
    id: "th",
    label: "泰国",
    emoji: "🇹🇭",
    keywords: ["泰国", "TH", "Thailand", "🇹🇭", "曼谷"],
  },
  {
    id: "in",
    label: "印度",
    emoji: "🇮🇳",
    keywords: ["印度", "IN", "India", "🇮🇳", "孟买"],
  },
  {
    id: "vn",
    label: "越南",
    emoji: "🇻🇳",
    keywords: ["越南", "VN", "Vietnam", "🇻🇳", "河内", "胡志明"],
  },
  {
    id: "ph",
    label: "菲律宾",
    emoji: "🇵🇭",
    keywords: ["菲律宾", "PH", "Philippines", "🇵🇭", "马尼拉"],
  },
  {
    id: "tr",
    label: "土耳其",
    emoji: "🇹🇷",
    keywords: ["土耳其", "TR", "Turkey", "🇹🇷", "伊斯坦布尔"],
  },
  {
    id: "ar",
    label: "阿根廷",
    emoji: "🇦🇷",
    keywords: ["阿根廷", "AR", "Argentina", "🇦🇷", "布宜诺斯艾利斯"],
  },
];

const DEFAULT_REGION: RegionPresetItem = {
  id: "other",
  label: "其他",
  emoji: "🌐",
  keywords: [],
};

/**
 * 从节点原始名称中识别出区域信息
 */
export function detectNodeRegion(nodeName: string): RegionPresetItem {
  if (!nodeName || typeof nodeName !== "string") return DEFAULT_REGION;
  const normalized = nodeName.trim();

  // 优先匹配预设
  for (const preset of EXTENDED_REGION_PRESETS) {
    for (const keyword of preset.keywords) {
      if (keyword.length === 1 && !preset.keywords.includes(keyword)) continue;
      // 词边界或包含匹配
      if (keyword.length <= 2) {
        // 短代码（如 HK, US, JP）做正则不区分大小写整词或前后有符号分隔匹配
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, "i");
        if (re.test(normalized)) return preset;
      } else {
        if (normalized.toLowerCase().includes(keyword.toLowerCase())) {
          return preset;
        }
      }
    }
  }

  return DEFAULT_REGION;
}

/**
 * 常见厂商与线路关键词映射
 */
const VENDOR_RULES: Array<{ label: string; regex: RegExp }> = [
  { label: "阿里云", regex: /阿里云|aliyun|alibaba/i },
  { label: "腾讯云", regex: /腾讯云|tencent|qcloud/i },
  { label: "华为云", regex: /华为云|huawei/i },
  { label: "谷歌云", regex: /谷歌云|google\s*cloud|\bgcp\b/i },
  { label: "AWS", regex: /亚马逊|\baws\b|amazon/i },
  { label: "甲骨文", regex: /甲骨文|oracle/i },
  { label: "微软云", regex: /微软云|\bazure\b/i },
  { label: "搬瓦工", regex: /搬瓦工|bandwagon|\bbwh\b/i },
  { label: "Cloudflare", regex: /cloudflare|\bcf\b/i },
  { label: "IPLC", regex: /\biplc\b|iplx/i },
  { label: "IEPL", regex: /\biepl\b/i },
  { label: "BGP", regex: /\bbgp\b/i },
  { label: "CN2", regex: /\bcn2(\s*gia)?\b/i },
  { label: "9929", regex: /\b9929\b/i },
  { label: "4837", regex: /\b4837\b/i },
  { label: "CMI", regex: /\bcmi\b/i },
];

/**
 * 从节点原始名称或信息中识别厂商或线路
 * 返回带中括号的字符串，如 "[阿里云]"，若无则返回空字符串 ""
 */
export function detectNodeVendor(nodeName: string): string {
  if (!nodeName || typeof nodeName !== "string") return "";

  for (const rule of VENDOR_RULES) {
    if (rule.regex.test(nodeName)) {
      return `[${rule.label}]`;
    }
  }

  // 尝试提取原名称中已有的方括号或中文括号内容，如 [某厂商] 或 【某厂商】
  const bracketMatch = nodeName.match(/[\[【]([^\]】]+)[\]】]/);
  if (bracketMatch && bracketMatch[1]) {
    const candidate = bracketMatch[1].trim();
    // 过滤掉纯数字或区域词
    if (candidate && !/^\d+$/.test(candidate) && !/香港|日本|美国|新加坡|韩国|台湾|德国|英国/.test(candidate)) {
      return `[${candidate}]`;
    }
  }

  return "";
}

/**
 * 推断节点协议类型（如未显式指定）
 */
export function detectNodeTypeFromName(nodeName: string): string {
  if (!nodeName) return "node";
  const lower = nodeName.toLowerCase();
  if (lower.includes("hysteria2") || lower.includes("hy2")) return "hysteria2";
  if (lower.includes("hysteria")) return "hysteria";
  if (lower.includes("vmess")) return "vmess";
  if (lower.includes("vless")) return "vless";
  if (lower.includes("trojan")) return "trojan";
  if (lower.includes("shadowsocks") || lower.includes("ss")) return "ss";
  if (lower.includes("snell")) return "snell";
  if (lower.includes("wireguard") || lower.includes("wg")) return "wireguard";
  if (lower.includes("tuic")) return "tuic";
  return "node";
}

export const DEFAULT_NODE_NAME_TEMPLATE = "{flag}{region}-{type}-{index}{vendor}";

/**
 * 格式化单个节点名称
 * 默认模板：{flag}{region}-{type}-{index}{vendor} (例如：🇺🇸美国-hysteria2-01[阿里云])
 */
export function formatNodeNameWithRegion(
  nodeName: string,
  index: number,
  template = DEFAULT_NODE_NAME_TEMPLATE,
  options?: { type?: string; vendor?: string }
): string {
  const region = detectNodeRegion(nodeName);
  const paddedIndex = index.toString().padStart(2, "0");
  const type = (options?.type || detectNodeTypeFromName(nodeName)).toLowerCase();
  const vendor = options?.vendor !== undefined ? options.vendor : detectNodeVendor(nodeName);

  let result = template
    .replaceAll("{flag}", region.emoji)
    .replaceAll("{region}", region.label)
    .replaceAll("{type}", type)
    .replaceAll("{index}", paddedIndex)
    .replaceAll("{vendor}", vendor)
    .replaceAll("{name}", nodeName.trim());

  return result.trim();
}

/**
 * 批量为节点列表重命名（同一区域同协议按顺序编号）
 */
export function batchFormatNodesWithRegion<T extends { name: string; type?: unknown }>(
  nodes: T[],
  options?: { template?: string; customVendor?: string }
): Array<{ oldName: string; newName: string; node: T }> {
  const template = options?.template || DEFAULT_NODE_NAME_TEMPLATE;
  const groupCounters = new Map<string, number>();

  return nodes.map((node) => {
    const oldName = node.name || "";
    const nodeType = typeof node.type === "string" ? node.type : detectNodeTypeFromName(oldName);
    const region = detectNodeRegion(oldName);
    const counterKey = `${region.id}-${nodeType}`;
    const count = (groupCounters.get(counterKey) ?? 0) + 1;
    groupCounters.set(counterKey, count);

    const vendor = options?.customVendor !== undefined
      ? (options.customVendor ? `[${options.customVendor}]` : "")
      : detectNodeVendor(oldName);

    const newName = formatNodeNameWithRegion(oldName, count, template, {
      type: nodeType,
      vendor,
    });

    return {
      oldName,
      newName,
      node,
    };
  });
}


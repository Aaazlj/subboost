/**
 * 节点区域识别与 Emoji 图标/国家名称格式化工具
 */

export interface RegionPresetItem {
  id: string;
  label: string;
  emoji: string;
  keywords: string[];
}

/**
 * 由 ISO 3166-1 alpha-2 国家码生成国旗 Emoji（任意国家都可用，无需预设）
 */
export function countryCodeToFlagEmoji(code: string): string {
  const normalized = (code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "🌐";
  return String.fromCodePoint(
    ...Array.from(normalized).map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)
  );
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
 * 扩展国家/地区预设（主要用于 GeoIP 国家码 → 中文名映射）
 * 每项：[ISO 国家码, 中文名, ...额外关键词]
 */
const EXTRA_REGION_DEFINITIONS: Array<[string, string, ...string[]]> = [
  ["MO", "澳门", "澳門"],
  ["NL", "荷兰", "Netherlands", "Holland", "阿姆斯特丹"],
  ["IT", "意大利", "Italy", "米兰", "罗马"],
  ["ES", "西班牙", "Spain", "马德里", "巴塞罗那"],
  ["SE", "瑞典", "Sweden", "斯德哥尔摩"],
  ["NO", "挪威", "Norway", "奥斯陆"],
  ["FI", "芬兰", "Finland", "赫尔辛基"],
  ["DK", "丹麦", "Denmark", "哥本哈根"],
  ["CH", "瑞士", "Switzerland", "苏黎世"],
  ["AT", "奥地利", "Austria", "维也纳"],
  ["BE", "比利时", "Belgium", "布鲁塞尔"],
  ["IE", "爱尔兰", "Ireland", "都柏林"],
  ["PL", "波兰", "Poland", "华沙"],
  ["CZ", "捷克", "Czech", "布拉格"],
  ["GR", "希腊", "Greece", "雅典"],
  ["PT", "葡萄牙", "Portugal", "里斯本"],
  ["RO", "罗马尼亚", "Romania"],
  ["HU", "匈牙利", "Hungary"],
  ["BG", "保加利亚", "Bulgaria"],
  ["RS", "塞尔维亚", "Serbia"],
  ["HR", "克罗地亚", "Croatia"],
  ["SK", "斯洛伐克", "Slovakia"],
  ["SI", "斯洛文尼亚", "Slovenia"],
  ["EE", "爱沙尼亚", "Estonia"],
  ["LV", "拉脱维亚", "Latvia"],
  ["LT", "立陶宛", "Lithuania"],
  ["IS", "冰岛", "Iceland"],
  ["LU", "卢森堡", "Luxembourg"],
  ["MT", "马耳他", "Malta"],
  ["CY", "塞浦路斯", "Cyprus"],
  ["UA", "乌克兰", "Ukraine", "基辅"],
  ["BY", "白俄罗斯", "Belarus"],
  ["GE", "格鲁吉亚", "Georgia"],
  ["AM", "亚美尼亚", "Armenia"],
  ["AZ", "阿塞拜疆", "Azerbaijan"],
  ["KZ", "哈萨克斯坦", "Kazakhstan"],
  ["UZ", "乌兹别克斯坦", "Uzbekistan"],
  ["KG", "吉尔吉斯斯坦", "Kyrgyzstan"],
  ["TJ", "塔吉克斯坦", "Tajikistan"],
  ["TM", "土库曼斯坦", "Turkmenistan"],
  ["MN", "蒙古", "Mongolia"],
  ["ID", "印度尼西亚", "Indonesia", "印尼", "雅加达"],
  ["BR", "巴西", "Brazil", "圣保罗"],
  ["MX", "墨西哥", "Mexico"],
  ["CL", "智利", "Chile"],
  ["PE", "秘鲁", "Peru"],
  ["CO", "哥伦比亚", "Colombia"],
  ["VE", "委内瑞拉", "Venezuela"],
  ["EC", "厄瓜多尔", "Ecuador"],
  ["UY", "乌拉圭", "Uruguay"],
  ["PY", "巴拉圭", "Paraguay"],
  ["BO", "玻利维亚", "Bolivia"],
  ["CR", "哥斯达黎加", "Costa Rica"],
  ["PA", "巴拿马", "Panama"],
  ["ZA", "南非", "South Africa", "约翰内斯堡", "开普敦"],
  ["EG", "埃及", "Egypt", "开罗"],
  ["AE", "阿联酋", "United Arab Emirates", "迪拜"],
  ["SA", "沙特", "Saudi Arabia", "利雅得"],
  ["QA", "卡塔尔", "Qatar"],
  ["KW", "科威特", "Kuwait"],
  ["BH", "巴林", "Bahrain"],
  ["OM", "阿曼", "Oman"],
  ["IL", "以色列", "Israel", "特拉维夫"],
  ["IR", "伊朗", "Iran", "德黑兰"],
  ["TR", "土耳其", "Turkey", "伊斯坦布尔"],
  ["JO", "约旦", "Jordan"],
  ["LB", "黎巴嫩", "Lebanon"],
  ["IQ", "伊拉克", "Iraq"],
  ["SY", "叙利亚", "Syria"],
  ["NG", "尼日利亚", "Nigeria"],
  ["KE", "肯尼亚", "Kenya"],
  ["ET", "埃塞俄比亚", "Ethiopia"],
  ["TZ", "坦桑尼亚", "Tanzania"],
  ["GH", "加纳", "Ghana"],
  ["MA", "摩洛哥", "Morocco"],
  ["DZ", "阿尔及利亚", "Algeria"],
  ["TN", "突尼斯", "Tunisia"],
  ["BD", "孟加拉", "Bangladesh"],
  ["PK", "巴基斯坦", "Pakistan"],
  ["LK", "斯里兰卡", "Sri Lanka"],
  ["NP", "尼泊尔", "Nepal"],
  ["MM", "缅甸", "Myanmar"],
  ["KH", "柬埔寨", "Cambodia"],
  ["LA", "老挝", "Laos"],
  ["NZ", "新西兰", "New Zealand", "奥克兰"],
  ["CN", "中国", "China", "大陆", "上海", "北京", "广州", "深圳", "ChinaNet"],
];

const ALL_REGION_PRESETS: RegionPresetItem[] = [
  ...EXTENDED_REGION_PRESETS,
  ...EXTRA_REGION_DEFINITIONS.map(([code, label, ...keywords]) => ({
    id: code.toLowerCase(),
    label,
    emoji: countryCodeToFlagEmoji(code),
    keywords: [label, code, ...keywords],
  })),
];

/** ISO 国家码 → 区域预设 */
const REGION_BY_CODE: Record<string, RegionPresetItem> = (() => {
  const map: Record<string, RegionPresetItem> = {};
  for (const preset of EXTENDED_REGION_PRESETS) {
    map[preset.id.toUpperCase()] = preset;
  }
  for (const preset of ALL_REGION_PRESETS) {
    if (!(preset.id.toUpperCase() in map)) {
      map[preset.id.toUpperCase()] = preset;
    }
  }
  // 常见非标准/别名国家码
  map["GB"] = map["UK"] ?? map["GB"];
  map["UK"] = map["GB"];
  map["TP"] = map["TW"];
  return map;
})();

/**
 * 按 ISO 国家码（如 US / JP / HK）获取区域预设，未收录则返回 undefined
 */
export function detectRegionByCountryCode(code?: string | null): RegionPresetItem | undefined {
  if (!code || typeof code !== "string") return undefined;
  return REGION_BY_CODE[code.trim().toUpperCase()];
}

/**
 * 由 GeoIP 结果生成区域信息：优先命中预设中文名，
 * 未收录的国家也能自动生成「国旗 + 国家名」
 */
export function regionFromGeo(
  countryCode?: string | null,
  countryName?: string | null
): RegionPresetItem {
  const byCode = detectRegionByCountryCode(countryCode);
  if (byCode) return byCode;

  const label = (countryName || "").trim();
  const code = (countryCode || "").trim().toUpperCase();
  if (label) {
    const byName = ALL_REGION_PRESETS.find((preset) => preset.label === label);
    if (byName) return byName;
    return {
      id: code ? code.toLowerCase() : label.toLowerCase(),
      label,
      emoji: countryCodeToFlagEmoji(code),
      keywords: [],
    };
  }
  if (code) {
    return { id: code.toLowerCase(), label: code, emoji: countryCodeToFlagEmoji(code), keywords: [] };
  }
  return DEFAULT_REGION;
}

const ASCII_KEYWORD_PATTERN = /^[a-zA-Z0-9 .-]+$/;
const regexCache = new Map<string, RegExp>();

function compileKeywordRegex(keyword: string): RegExp {
  const cached = regexCache.get(keyword);
  if (cached) return cached;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const compiled = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, "i");
  regexCache.set(keyword, compiled);
  return compiled;
}

function keywordMatches(normalized: string, keyword: string): boolean {
  // 纯 ASCII 关键词（国家码 / 英文名）按词边界匹配，避免 "Oman" 命中 "Woman" 之类误判
  if (ASCII_KEYWORD_PATTERN.test(keyword)) {
    return compileKeywordRegex(keyword).test(normalized);
  }
  return normalized.toLowerCase().includes(keyword.toLowerCase());
}

/**
 * 从节点原始名称中识别出区域信息
 */
export function detectNodeRegion(nodeName: string): RegionPresetItem {
  if (!nodeName || typeof nodeName !== "string") return DEFAULT_REGION;
  const normalized = nodeName.trim();
  if (!normalized) return DEFAULT_REGION;

  // 优先匹配预设
  for (const preset of ALL_REGION_PRESETS) {
    for (const keyword of preset.keywords) {
      if (keyword.length <= 1 && !ASCII_KEYWORD_PATTERN.test(keyword)) {
        if (!normalized.includes(keyword)) continue;
        return preset;
      }
      if (keywordMatches(normalized, keyword)) return preset;
    }
  }

  return DEFAULT_REGION;
}

/**
 * 从节点信息中解析区域：优先使用 GeoIP 落地国家码，其次回落到名称识别
 */
export function resolveNodeRegion(node: unknown): RegionPresetItem {
  if (!node || typeof node !== "object") return DEFAULT_REGION;
  const record = node as Record<string, unknown>;
  const geoCode = record["_geoCountry"];
  if (typeof geoCode === "string" && geoCode.trim()) {
    const byGeo = regionFromGeo(
      geoCode,
      typeof record["_geoCountryName"] === "string" ? record["_geoCountryName"] : undefined
    );
    if (byGeo.id !== "other") return byGeo;
  }
  const origin = record["_originName"];
  const originName = typeof origin === "string" && origin.trim() ? origin.trim() : "";
  const nodeName = typeof record["name"] === "string" ? record["name"] : "";
  return detectNodeRegion(originName || nodeName);
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
  options?: { type?: string; vendor?: string; region?: RegionPresetItem }
): string {
  const region = options?.region ?? detectNodeRegion(nodeName);
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

export type BatchFormatNodesOptions<T> = {
  template?: string;
  customVendor?: string;
  /** 自定义区域判定（例如 GeoIP 结果），返回 undefined 时回落到名称识别 */
  regionResolver?: (node: T, index: number) => RegionPresetItem | undefined;
  /** 自定义厂商（返回值不含中括号），返回 undefined 时回落到名称识别 */
  vendorResolver?: (node: T, index: number) => string | undefined;
};

/**
 * 批量为节点列表重命名（同一区域同协议按顺序编号）
 */
export function batchFormatNodesWithRegion<T extends { name: string; type?: unknown }>(
  nodes: T[],
  options?: BatchFormatNodesOptions<T>
): Array<{ oldName: string; newName: string; node: T }> {
  const template = options?.template || DEFAULT_NODE_NAME_TEMPLATE;
  const groupCounters = new Map<string, number>();

  return nodes.map((node, index) => {
    const oldName = node.name || "";
    const nodeType = typeof node.type === "string" ? node.type : detectNodeTypeFromName(oldName);
    const record = node as unknown as Record<string, unknown>;
    const originName =
      typeof record["_originName"] === "string" && record["_originName"].trim()
        ? String(record["_originName"]).trim()
        : oldName;
    const region = options?.regionResolver?.(node, index) ?? detectNodeRegion(originName);
    const counterKey = `${region.id}-${nodeType}`;
    const count = (groupCounters.get(counterKey) ?? 0) + 1;
    groupCounters.set(counterKey, count);

    let vendor: string;
    if (options?.customVendor !== undefined) {
      vendor = options.customVendor ? `[${options.customVendor}]` : "";
    } else {
      const resolved = options?.vendorResolver?.(node, index);
      vendor = resolved !== undefined
        ? (resolved ? `[${resolved}]` : "")
        : detectNodeVendor(originName);
    }

    const newName = formatNodeNameWithRegion(oldName, count, template, {
      type: nodeType,
      vendor,
      region,
    });

    return {
      oldName,
      newName,
      node,
    };
  });
}


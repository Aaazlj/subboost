import { describe, expect, it } from "vitest";
import {
  detectNodeRegion,
  detectNodeVendor,
  formatNodeNameWithRegion,
  batchFormatNodesWithRegion,
} from "./node-region-formatter";

describe("node-region-formatter", () => {
  it("正确识别常见国家和地区", () => {
    expect(detectNodeRegion("HK-01-BGP").emoji).toBe("🇭🇰");
    expect(detectNodeRegion("香港 01 高速").label).toBe("香港");

    expect(detectNodeRegion("JP Tokyo 02").emoji).toBe("🇯🇵");
    expect(detectNodeRegion("日本 大阪 专线").label).toBe("日本");

    expect(detectNodeRegion("US Los Angeles").emoji).toBe("🇺🇸");
    expect(detectNodeRegion("美国 硅谷 01").label).toBe("美国");

    expect(detectNodeRegion("SG Singapore 01").emoji).toBe("🇸🇬");
    expect(detectNodeRegion("新加坡 狮城 02").label).toBe("新加坡");

    expect(detectNodeRegion("Taiwan 01").emoji).toBe("🇹🇼");
    expect(detectNodeRegion("台湾 台北 02").label).toBe("台湾");

    expect(detectNodeRegion("Korea Seoul").emoji).toBe("🇰🇷");
    expect(detectNodeRegion("未知无国家节点").label).toBe("其他");
  });

  it("正确识别厂商与线路", () => {
    expect(detectNodeVendor("US-01 阿里云")).toBe("[阿里云]");
    expect(detectNodeVendor("HK-AWS-01")).toBe("[AWS]");
    expect(detectNodeVendor("JP-Tokyo [搬瓦工] 01")).toBe("[搬瓦工]");
    expect(detectNodeVendor("普通无厂商节点")).toBe("");
  });

  it("格式化单个节点名称，符合用户要求的规范如 🇺🇸美国-hysteria2[阿里云]", () => {
    const formatted = formatNodeNameWithRegion("US 阿里云高速", 1, undefined, {
      type: "hysteria2",
    });
    expect(formatted).toBe("🇺🇸美国-hysteria2[阿里云]");

    const formattedWithoutVendor = formatNodeNameWithRegion("HK-Node-01", 2, undefined, {
      type: "vmess",
    });
    expect(formattedWithoutVendor).toBe("🇭🇰香港-vmess");
  });

  it("批量为同区域同协议节点识别国家和协议并识别厂商（无序号）", () => {
    const nodes = [
      { name: "US-01 阿里云 hy2", type: "hysteria2" },
      { name: "US-02 阿里云 hy2", type: "hysteria2" },
      { name: "HK-01 AWS vmess", type: "vmess" },
      { name: "JP-01 无厂商 trojan", type: "trojan" },
    ];

    const result = batchFormatNodesWithRegion(nodes);
    expect(result.map((r) => r.newName)).toEqual([
      "🇺🇸美国-hysteria2[阿里云]",
      "🇺🇸美国-hysteria2[阿里云]",
      "🇭🇰香港-vmess[AWS]",
      "🇯🇵日本-trojan",
    ]);
  });
});


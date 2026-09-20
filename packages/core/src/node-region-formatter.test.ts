import { describe, expect, it } from "vitest";
import {
  detectNodeRegion,
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

  it("格式化单个节点名称", () => {
    const formatted = formatNodeNameWithRegion("HK-Node-BGP", 1);
    expect(formatted).toBe("🇭🇰 香港 01");

    const custom = formatNodeNameWithRegion("US-Node", 2, "{flag} {region} | {name}");
    expect(custom).toBe("🇺🇸 美国 | US-Node");
  });

  it("批量为同区域节点顺序编号", () => {
    const nodes = [
      { name: "HK-01" },
      { name: "US-01" },
      { name: "HK-02" },
      { name: "SG-01" },
      { name: "US-02" },
    ];

    const result = batchFormatNodesWithRegion(nodes);
    expect(result.map((r) => r.newName)).toEqual([
      "🇭🇰 香港 01",
      "🇺🇸 美国 01",
      "🇭🇰 香港 02",
      "🇸🇬 新加坡 01",
      "🇺🇸 美国 02",
    ]);
  });
});

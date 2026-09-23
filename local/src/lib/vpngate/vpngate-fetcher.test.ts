import { describe, expect, it } from "vitest";
import { inferIpType, parseVpngateCsv } from "./vpngate-fetcher";

describe("vpngate-fetcher", () => {
  it("正确识别住宅、教育网与机房 IP", () => {
    expect(inferIpType("219.100.37.10", "NTT", "")).toBe("教育网");
    expect(inferIpType("1.2.3.4", "Tokyo University", "")).toBe("教育网");
    expect(inferIpType("5.6.7.8", "OVH Hosting Datacenter", "")).toBe("机房");
    expect(inferIpType("123.45.67.89", "Comcast Cable Broadband", "")).toBe("住宅/家庭宽带");
    expect(inferIpType("98.76.54.32", "Normal Volunteer", "")).toBe("住宅/家庭宽带");
  });

  it("正确解析 VPNGate CSV 文本", () => {
    const mockCsv = `*vpn_servers
#HostName,IP,Score,Ping,Speed,CountryLong,CountryShort,NumVpnSessions,Uptime,TotalUsers,TotalTraffic,LogType,Operator,Message,OpenVPN_ConfigData_Base64
vg-test-1,14.0.0.1,50000,15,10000000,Japan,JP,10,1000,500,20000000,2weeks,NTT Home,Hello,Y29uZmlnMQ==
vg-test-2,15.0.0.2,30000,35,5000000,United States,US,5,2000,300,10000000,2weeks,Comcast Residential,Welcome,Y29uZmlnMg==
*test_end`;

    const nodes = parseVpngateCsv(mockCsv);
    expect(nodes.length).toBe(2);
    expect(nodes[0].hostname).toBe("vg-test-1");
    expect(nodes[0].countryShort).toBe("JP");
    expect(nodes[0].openvpnConfigBase64).toBe("Y29uZmlnMQ==");
    expect(nodes[1].countryShort).toBe("US");
    expect(nodes[1].ipType).toBe("住宅/家庭宽带");
  });
});

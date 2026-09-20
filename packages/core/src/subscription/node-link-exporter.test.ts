import { describe, expect, it } from "vitest";
import type { ParsedNode } from "@subboost/core/types/node";
import {
  exportNodeToLink,
  exportNodesToPlaintextSubscription,
  exportNodesToV2rayNSubscription,
} from "./node-link-exporter";

describe("node-link-exporter", () => {
  it("正确导出 SS 节点", () => {
    const node: ParsedNode = {
      type: "ss",
      name: "香港 SS 01",
      server: "1.2.3.4",
      port: 8388,
      cipher: "aes-256-gcm",
      password: "test-password",
    };
    const link = exportNodeToLink(node);
    expect(link).toBeTruthy();
    expect(link?.startsWith("ss://")).toBe(true);
    expect(link).toContain("1.2.3.4:8388");
  });

  it("正确导出 VMess 节点", () => {
    const node: ParsedNode = {
      type: "vmess",
      name: "日本 VMess",
      server: "jp.example.com",
      port: 443,
      uuid: "12345678-1234-1234-1234-123456789012",
      alterId: 0,
      cipher: "auto",
      tls: true,
      network: "ws",
    };
    const link = exportNodeToLink(node);
    expect(link).toBeTruthy();
    expect(link?.startsWith("vmess://")).toBe(true);

    const base64Part = link!.replace("vmess://", "");
    const decoded = JSON.parse(Buffer.from(base64Part, "base64").toString("utf-8"));
    expect(decoded.add).toBe("jp.example.com");
    expect(decoded.id).toBe("12345678-1234-1234-1234-123456789012");
  });

  it("正确生成通用订阅与 v2rayN Base64 订阅", () => {
    const nodes: ParsedNode[] = [
      {
        type: "ss",
        name: "Node 1",
        server: "1.1.1.1",
        port: 8000,
        cipher: "chacha20-ietf-poly1305",
        password: "pw",
      },
      {
        type: "trojan",
        name: "Node 2",
        server: "2.2.2.2",
        port: 443,
        password: "tpw",
      },
    ];

    const plaintext = exportNodesToPlaintextSubscription(nodes);
    expect(plaintext.split("\n").length).toBe(2);
    expect(plaintext).toContain("ss://");
    expect(plaintext).toContain("trojan://");

    const v2rayn = exportNodesToV2rayNSubscription(nodes);
    const decoded = Buffer.from(v2rayn, "base64").toString("utf-8");
    expect(decoded).toBe(plaintext);
  });
});

/**
 * 节点链接导出器：将 ParsedNode 导出为单节点链接与 v2rayN / 通用订阅
 */

import type {
  ParsedNode,
  SSNode,
  VMessNode,
  VLESSNode,
  TrojanNode,
  Hysteria2Node,
} from "@subboost/core/types/node";

function toBase64(str: string): string {
  return Buffer.from(str, "utf-8").toString("base64");
}

function safeEncode(str?: string): string {
  if (!str) return "";
  return encodeURIComponent(str);
}

/**
 * 将单个节点转为通用链接 (URL)
 */
export function exportNodeToLink(node: ParsedNode): string | null {
  if (!node || !node.type || !node.server || !node.port) {
    return null;
  }

  const nameTag = safeEncode(node.name || `${node.server}:${node.port}`);

  switch (node.type) {
    case "ss": {
      const ss = node as SSNode;
      if (!ss.cipher || !ss.password) return null;
      // SIP002 格式
      const userinfo = toBase64(`${ss.cipher}:${ss.password}`);
      return `ss://${userinfo}@${ss.server}:${ss.port}#${nameTag}`;
    }

    case "vmess": {
      const vmess = node as VMessNode;
      if (!vmess.uuid) return null;
      const vmessJson = {
        v: "2",
        ps: node.name || "",
        add: vmess.server,
        port: vmess.port,
        id: vmess.uuid,
        aid: vmess.alterId ?? 0,
        scy: vmess.cipher || "auto",
        net: vmess.network || "tcp",
        type: "none",
        host: vmess["ws-opts"]?.headers?.Host || vmess["ws-opts"]?.headers?.host || vmess.servername || "",
        path: vmess["ws-opts"]?.path || "",
        tls: vmess.tls ? "tls" : "",
        sni: vmess.servername || "",
        alpn: Array.isArray(vmess.alpn) ? vmess.alpn.join(",") : "",
      };
      return `vmess://${toBase64(JSON.stringify(vmessJson))}`;
    }

    case "vless": {
      const vless = node as VLESSNode;
      if (!vless.uuid) return null;
      const params = new URLSearchParams();
      params.set("encryption", vless.encryption || "none");
      const isReality = Boolean(vless["reality-opts"]);
      params.set("security", vless.tls ? (isReality ? "reality" : "tls") : "none");
      if (vless.network) params.set("type", vless.network);
      if (vless.flow) params.set("flow", vless.flow);
      if (vless.servername) params.set("sni", vless.servername);
      if (isReality && vless["reality-opts"]) {
        const ro = vless["reality-opts"];
        if (ro["public-key"]) params.set("pbk", String(ro["public-key"]));
        if (ro["short-id"]) params.set("sid", String(ro["short-id"]));
      }
      if (vless["ws-opts"]?.path) params.set("path", vless["ws-opts"].path);
      if (vless["ws-opts"]?.headers?.Host) params.set("host", vless["ws-opts"].headers.Host);

      const qs = params.toString();
      return `vless://${vless.uuid}@${vless.server}:${vless.port}${qs ? `?${qs}` : ""}#${nameTag}`;
    }

    case "trojan": {
      const trojan = node as TrojanNode;
      if (!trojan.password) return null;
      const params = new URLSearchParams();
      params.set("security", trojan.tls !== false ? "tls" : "none");
      if (trojan.sni) params.set("sni", trojan.sni);
      if (trojan.network) params.set("type", trojan.network);
      if (trojan["ws-opts"]?.path) params.set("path", trojan["ws-opts"].path);
      if (trojan["ws-opts"]?.headers?.Host) params.set("host", trojan["ws-opts"].headers.Host);

      const qs = params.toString();
      return `trojan://${safeEncode(trojan.password)}@${trojan.server}:${trojan.port}${qs ? `?${qs}` : ""}#${nameTag}`;
    }

    case "hysteria2": {
      const hy2 = node as Hysteria2Node;
      if (!hy2.password) return null;
      const params = new URLSearchParams();
      if (hy2.sni) params.set("sni", hy2.sni);
      if (hy2["skip-cert-verify"]) params.set("insecure", "1");
      if (hy2.obfs) params.set("obfs", hy2.obfs);
      if (hy2["obfs-password"]) params.set("obfs-password", hy2["obfs-password"]);

      const qs = params.toString();
      return `hysteria2://${safeEncode(hy2.password)}@${hy2.server}:${hy2.port}${qs ? `?${qs}` : ""}#${nameTag}`;
    }

    default: {
      // 其它协议如果未显式支持，暂时跳过
      return null;
    }
  }
}

/**
 * 将节点列表转为单链接列表
 */
export function exportNodesToLinks(nodes: ParsedNode[]): string[] {
  if (!Array.isArray(nodes)) return [];
  const links: string[] = [];
  for (const node of nodes) {
    const link = exportNodeToLink(node);
    if (link) links.push(link);
  }
  return links;
}

/**
 * 通用订阅：多行节点链接明文
 */
export function exportNodesToPlaintextSubscription(nodes: ParsedNode[]): string {
  const links = exportNodesToLinks(nodes);
  return links.join("\n");
}

/**
 * v2rayN 订阅：多行链接整体 Base64 编码
 */
export function exportNodesToV2rayNSubscription(nodes: ParsedNode[]): string {
  const plaintext = exportNodesToPlaintextSubscription(nodes);
  return toBase64(plaintext);
}

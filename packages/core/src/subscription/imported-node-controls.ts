import type { ParsedNode } from "../types/node";

const IMPORTED_NODE_CONTROL_FIELDS = new Set<string>(["dialer-proxy", "dialer_proxy"]);

/**
 * 由 SubBoost 界面自身创建的住宅落地节点标记。
 *
 * 外部订阅导入的节点绝不允许携带该标记：订阅导入路径会调用
 * `stripUiOwnedNodeFlags` 把它清掉，因此节点只有可能是本应用自己写进去的，
 * 这样「链式中转」才不会被订阅内容伪造并劫持流量。
 */
const UI_OWNED_RESIDENTIAL_FLAG = "_isResidential";

function isUiOwnedResidentialNode(record: Record<string, unknown>): boolean {
  return record[UI_OWNED_RESIDENTIAL_FLAG] === true;
}

export function stripImportedNodeControlFields(node: ParsedNode): ParsedNode {
  if (!node || typeof node !== "object") return node;

  const record = node as unknown as Record<string, unknown>;
  // 住宅落地节点由本应用界面创建，需要保留 dialer-proxy 才能链式落地
  const keepDialerProxy = isUiOwnedResidentialNode(record);
  let changed = false;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (IMPORTED_NODE_CONTROL_FIELDS.has(key) && !keepDialerProxy) {
      changed = true;
      continue;
    }
    sanitized[key] = value;
  }

  return changed ? (sanitized as ParsedNode) : node;
}

export function stripImportedNodeControlFieldsFromList(nodes: ParsedNode[]): ParsedNode[] {
  return nodes.map(stripImportedNodeControlFields);
}

/**
 * 订阅导入专用：清掉界面自建标记，避免外部订阅冒充住宅落地节点后保留 dialer-proxy。
 * 只用于「外部内容进入系统」的路径，不要用在配置持久化或生成链路里。
 */
export function stripUiOwnedNodeFlags(node: ParsedNode): ParsedNode {
  if (!node || typeof node !== "object") return node;

  const record = node as unknown as Record<string, unknown>;
  if (!(UI_OWNED_RESIDENTIAL_FLAG in record)) return node;

  let changed = false;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (key === UI_OWNED_RESIDENTIAL_FLAG) {
      changed = true;
      continue;
    }
    sanitized[key] = value;
  }

  return changed ? (sanitized as ParsedNode) : node;
}

export function stripUiOwnedNodeFlagsFromList(nodes: ParsedNode[]): ParsedNode[] {
  return nodes.map(stripUiOwnedNodeFlags);
}

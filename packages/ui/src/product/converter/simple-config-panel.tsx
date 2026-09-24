"use client";

import * as React from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Edit2,
  FolderPlus,
  Globe2,
  Layers,
  Link as LinkIcon,
  Loader2,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import { IconButton } from "@subboost/ui/components/ui/icon-button";
import { Input } from "@subboost/ui/components/ui/input";
import { Textarea } from "@subboost/ui/components/ui/textarea";
import { Badge } from "@subboost/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@subboost/ui/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@subboost/ui/components/ui/dialog";
import { confirmDialog as confirm } from "@subboost/ui/components/ui/confirm-dialog";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { withBasePath } from "@subboost/ui/lib/base-path";
import { useConfigStore } from "@subboost/ui/store/config-store";
import { batchFormatNodesWithRegion, regionFromGeo, resolveNodeRegion } from "@subboost/core/node-region-formatter";
import type { ParsedNode } from "@subboost/core/types/node";
import { cn } from "@subboost/ui/lib/utils";
import { ResidentialPoolPanel, type ActiveTunnelItem } from "./residential-pool-panel";
import { ActiveTunnelsPanel } from "./active-tunnels-panel";
import { SettingsPanel } from "./settings-panel";

type SubscriptionItem = {
  id: string;
  name: string;
  token: string;
  isPrimary?: boolean;
  autoUpdateInterval?: number | null;
  updatedAt?: string;
};

/** 一行一个订阅：链接 + 该订阅的厂商标记 */
type SourceRow = {
  id: string;
  url: string;
  vendor: string;
};

function createRowId(): string {
  return `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyRow(): SourceRow {
  return { id: createRowId(), url: "", vendor: "" };
}

function readSourceIds(node: ParsedNode): string[] {
  const raw = (node as unknown as Record<string, unknown>)["_sourceIds"];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item));
}

function buildVendorBySourceId(
  sources: Array<{ id: string; vendor?: string }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const source of sources) {
    const vendor = typeof source.vendor === "string" ? source.vendor.trim() : "";
    if (vendor) map.set(source.id, vendor);
  }
  return map;
}

/** 节点所属订阅若设置了厂商，则优先使用该厂商 */
function makeVendorResolver(sources: Array<{ id: string; vendor?: string }>) {
  const vendorBySourceId = buildVendorBySourceId(sources);
  return (node: ParsedNode): string | undefined => {
    for (const id of readSourceIds(node)) {
      const vendor = vendorBySourceId.get(id);
      if (vendor) return vendor;
    }
    return undefined;
  };
}

export function SimpleConfigPanel() {
  const { toast } = useToast();
  const {
    nodes,
    sources,
    setSources,
    parseMultipleSources,
    clearNodes,
    removeNode,
    renameNode,
    generateConfig,
  } = useConfigStore();

  // 后台全局导航：subscriptions 订阅管理 | residential 全球住宅节点池 | tunnels 已激活隧道管理 | settings 系统设置
  const [mainNav, setMainNav] = React.useState<"subscriptions" | "residential" | "tunnels" | "settings">("subscriptions");
  // 订阅管理子视图：list 列表视图 | edit 编辑详情视图
  const [viewMode, setViewMode] = React.useState<"list" | "edit">("list");

  // 引入住宅落地节点弹窗状态与接入模式
  const [residentialDialogOpen, setResidentialDialogOpen] = React.useState(false);
  const [residentialMode, setResidentialMode] = React.useState<"transit" | "direct">("transit");
  const [activeTunnels, setActiveTunnels] = React.useState<ActiveTunnelItem[]>([]);
  const [activeTunnelCount, setActiveTunnelCount] = React.useState<number>(0);
  const [selectedTunnelId, setSelectedTunnelId] = React.useState<string>("");
  const [selectedDialerProxy, setSelectedDialerProxy] = React.useState<string>("");
  const [isLoadingActiveTunnels, setIsLoadingActiveTunnels] = React.useState(false);

  // 定时刷新活跃隧道数量（供侧边栏 Badge 显示）
  const fetchActiveTunnelCount = React.useCallback(async () => {
    try {
      const res = await fetch(withBasePath("/api/vpngate/tunnels"), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tunnels)) {
          setActiveTunnelCount(data.tunnels.length);
        }
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    fetchActiveTunnelCount();
    const timer = setInterval(fetchActiveTunnelCount, 12000);
    return () => clearInterval(timer);
  }, [fetchActiveTunnelCount]);

  // 配置列表状态
  const [subscriptions, setSubscriptions] = React.useState<SubscriptionItem[]>([]);
  const [isLoadingList, setIsLoadingList] = React.useState(false);
  const [currentSubId, setCurrentSubId] = React.useState<string | null>(null);
  const [currentSubToken, setCurrentSubToken] = React.useState<string | null>(null);

  // 表单状态
  const [configName, setConfigName] = React.useState("我的主力配置");
  const [sourceRows, setSourceRows] = React.useState<SourceRow[]>([createEmptyRow()]);
  const [manualContent, setManualContent] = React.useState("");
  const [isParsing, setIsParsing] = React.useState(false);
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isApplying, setIsApplying] = React.useState(false);

  // 订阅行编辑
  const updateSourceRow = (id: string, patch: Partial<SourceRow>) => {
    setSourceRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeSourceRow = (id: string) => {
    setSourceRows((prev) => (prev.length <= 1 ? [createEmptyRow()] : prev.filter((row) => row.id !== id)));
  };

  // 节点列表交互状态
  const [searchKeyword, setSearchKeyword] = React.useState("");
  const [selectedRegionId, setSelectedRegionId] = React.useState<string>("all");
  const [editingNodeIndex, setEditingNodeIndex] = React.useState<number | null>(null);
  const [editingNodeName, setEditingNodeName] = React.useState("");

  // 订阅链接弹窗
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);
  const [copiedType, setCopiedType] = React.useState<string | null>(null);

  // 加载配置列表
  const fetchSubscriptions = React.useCallback(async () => {
    setIsLoadingList(true);
    try {
      const res = await fetch(withBasePath("/api/subscriptions"), { cache: "no-store" });
      if (!res.ok) throw new Error("获取配置列表失败");
      const data = await res.json();
      if (Array.isArray(data.subscriptions)) {
        setSubscriptions(data.subscriptions);
      }
    } catch {
      // 忽略初次未登录等网络异常
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  React.useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  // 从列表页点击【新建配置】
  const handleOpenCreate = () => {
    setCurrentSubId(null);
    setCurrentSubToken(null);
    setConfigName(`新配置 ${new Date().toLocaleDateString("zh-CN")}`);
    setSourceRows([createEmptyRow()]);
    setManualContent("");
    clearNodes();
    setViewMode("edit");
  };

  // 从列表页点击【编辑详情】
  const handleOpenEdit = async (id: string) => {
    await handleSelectSubscription(id);
    setViewMode("edit");
  };

  // 从详情页返回列表
  const handleBackToList = async () => {
    await fetchSubscriptions();
    setViewMode("list");
  };

  // 在列表页直接应用某个配置
  const handleApplyById = async (id: string, name: string) => {
    setIsApplying(true);
    try {
      const res = await fetch(withBasePath(`/api/subscriptions/${encodeURIComponent(id)}/apply`), {
        method: "POST",
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "应用配置失败");
      }
      await fetchSubscriptions();
      toast({
        title: "配置已应用",
        description: `配置「${name}」已成功应用至 clash.leozai.com，主订阅已更新。`,
      });
    } catch (err: unknown) {
      toast({
        title: "应用失败",
        description: err instanceof Error ? err.message : "请稍后重试。",
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  };

  // 在列表页删除指定配置
  const handleDeleteById = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: "确定删除此配置？",
      description: `删除后，配置「${name}」对应的订阅链接将永久失效。`,
      confirmText: "确定删除",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(withBasePath(`/api/subscriptions/${encodeURIComponent(id)}`), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("删除配置失败");
      toast({ title: "配置已删除" });
      if (currentSubId === id) {
        setCurrentSubId(null);
        setCurrentSubToken(null);
        clearNodes();
      }
      await fetchSubscriptions();
    } catch (err: unknown) {
      toast({
        title: "删除失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    }
  };

  // 在列表页直接弹窗查看链接
  const handleOpenLinkDialogForSub = (sub: SubscriptionItem) => {
    setCurrentSubId(sub.id);
    setCurrentSubToken(sub.token);
    setConfigName(sub.name);
    setLinkDialogOpen(true);
  };

  // 打开引入住宅落地节点弹窗并拉取活跃隧道
  const handleOpenResidentialDialog = async (preselectTunnel?: ActiveTunnelItem) => {
    setIsLoadingActiveTunnels(true);
    setResidentialDialogOpen(true);
    if (!selectedDialerProxy) {
      const normalNodes = nodes.filter((n) => {
        const raw = n as unknown as Record<string, unknown>;
        return !raw["_isResidential"] && !raw["dialer-proxy"];
      });
      if (normalNodes.length > 0) {
        setSelectedDialerProxy(normalNodes[0].name);
      }
    }
    try {
      const res = await fetch(withBasePath("/api/vpngate/tunnels"), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tunnels)) {
          setActiveTunnels(data.tunnels);
          if (preselectTunnel) {
            setSelectedTunnelId(preselectTunnel.id);
          } else if (data.tunnels.length > 0 && !selectedTunnelId) {
            setSelectedTunnelId(data.tunnels[0].id);
          }
        }
      }
    } catch {
      // 忽略异常
    } finally {
      setIsLoadingActiveTunnels(false);
    }
  };

  // 确认将住宅落地节点注入当前配置
  const handleConfirmAddResidentialNode = () => {
    const tunnel = activeTunnels.find((t) => t.id === selectedTunnelId);
    if (!tunnel) {
      toast({ title: "请选择活跃隧道", variant: "destructive" });
      return;
    }
    if (residentialMode === "transit" && !selectedDialerProxy) {
      toast({
        title: "请选择前置中转节点",
        description: "链式中转模式必须选择前置中转节点进行 dialer-proxy 拨号。",
        variant: "destructive",
      });
      return;
    }

    const reg = regionFromGeo(tunnel.country, tunnel.country);
    const host = tunnel.publicIp || "47.89.253.12";
    const modeTag = residentialMode === "transit" ? "住宅IP" : "直连住宅";
    const baseName = `${reg.emoji}${reg.label}-socks5[${modeTag}]`;

    // 避免同名冲突
    let finalName = baseName;
    const existingNames = new Set(nodes.map((n) => n.name));
    let counter = 2;
    while (existingNames.has(finalName)) {
      finalName = `${baseName} (${counter++})`;
    }

    const newNode: Record<string, unknown> = {
      name: finalName,
      type: "socks5",
      server: host,
      port: tunnel.port,
      // 住宅落地走本项目自建的 SOCKS5 中继，只实现了 CONNECT，标记 UDP 会让客户端
      // 走 UDP ASSOCIATE 失败，因此这里必须是 false。
      udp: false,
      _originName: finalName,
      _isResidential: true,
    };

    if (tunnel.username) newNode.username = tunnel.username;
    if (tunnel.password) newNode.password = tunnel.password;

    if (residentialMode === "transit") {
      newNode["dialer-proxy"] = selectedDialerProxy;
    }

    useConfigStore.setState({ nodes: [...nodes, newNode as unknown as ParsedNode] });
    generateConfig();
    setResidentialDialogOpen(false);
    toast({
      title: "已引入住宅落地节点",
      description: `「${finalName}」已加入节点列表 (公网地址: ${host}:${tunnel.port}${residentialMode === "transit" ? `，前置拨号: ${selectedDialerProxy}` : ""})。`,
    });
  };

  // 载入特定配置
  const handleSelectSubscription = async (id: string) => {
    try {
      const res = await fetch(withBasePath(`/api/subscriptions/${encodeURIComponent(id)}`), { cache: "no-store" });
      if (!res.ok) throw new Error("加载配置详情失败");
      const data = await res.json();
      const sub = data.subscription;
      if (sub) {
        setCurrentSubId(sub.id);
        setCurrentSubToken(sub.token);
        setConfigName(sub.name || "未命名配置");
        const savedVendors =
          sub.config && typeof sub.config === "object" && !Array.isArray(sub.config)
            ? ((sub.config as Record<string, unknown>).sourceVendors as Record<string, unknown> | undefined)
            : undefined;
        const urls = Array.isArray(sub.urls) ? sub.urls.filter((u: unknown) => typeof u === "string") : [];
        setSourceRows(
          urls.length > 0
            ? urls.map((url: string) => ({
                id: createRowId(),
                url,
                vendor:
                  savedVendors && typeof savedVendors[url] === "string" ? String(savedVendors[url]) : "",
              }))
            : [createEmptyRow()]
        );
        setManualContent("");
        if (Array.isArray(sub.nodes)) {
          useConfigStore.setState({
            nodes: sub.nodes,
            deletedNodeNames: [],
            deletedNodes: [],
          });
          generateConfig();
        }
        toast({
          title: "配置已载入",
          description: `已加载配置「${sub.name}」，包含 ${sub.nodes?.length ?? 0} 个节点。`,
        });
      }
    } catch {
      toast({
        title: "加载配置失败",
        description: "网络错误或配置已被删除。",
        variant: "destructive",
      });
    }
  };

  // 新建配置
  const handleNewConfig = async () => {
    if (nodes.length > 0) {
      const confirmed = await confirm({
        title: "新建配置？",
        description: "当前正在编辑的配置节点将被重置，未保存的内容将丢失。",
        variant: "warning",
      });
      if (!confirmed) return;
    }
    setCurrentSubId(null);
    setCurrentSubToken(null);
    setConfigName(`新配置 ${new Date().toLocaleDateString("zh-CN")}`);
    setSourceRows([createEmptyRow()]);
    setManualContent("");
    clearNodes();
    toast({
      title: "已开启新配置",
      description: "请在下方粘贴订阅或节点内容后点击【解析并导入】。",
    });
  };

  // 删除当前配置
  const handleDeleteConfig = async () => {
    if (!currentSubId) return;
    const confirmed = await confirm({
      title: "确定删除此配置？",
      description: `删除后，配置「${configName}」对应的订阅链接将永久失效。`,
      confirmText: "确定删除",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(withBasePath(`/api/subscriptions/${encodeURIComponent(currentSubId)}`), {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("删除配置失败");
      toast({ title: "配置已删除" });
      setCurrentSubId(null);
      setCurrentSubToken(null);
      clearNodes();
      setSourceRows([createEmptyRow()]);
      setManualContent("");
      await fetchSubscriptions();
      setViewMode("list");
    } catch (err: unknown) {
      toast({
        title: "删除失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    }
  };

  // 解析并导入源：一行一个订阅，每个订阅可单独设置厂商
  const handleImport = async () => {
    const rows = sourceRows
      .map((row) => ({ ...row, url: row.url.trim(), vendor: row.vendor.trim() }))
      .filter((row) => row.url !== "");
    const manual = manualContent.trim();

    if (rows.length === 0 && manual === "") {
      toast({
        title: "请输入订阅或节点内容",
        description: "每行填写一个订阅链接并可选设置厂商，或在下方粘贴节点/YAML 内容。",
        variant: "destructive",
      });
      return;
    }

    setIsParsing(true);
    try {
      const newSources: Array<{ id: string; type: "url" | "yaml" | "nodes"; content: string; tag: string; vendor?: string }> = [];

      rows.forEach((row, idx) => {
        newSources.push({
          id: `src-${Date.now()}-${idx}`,
          type: "url",
          content: row.url,
          tag: row.vendor || `源 ${idx + 1}`,
          ...(row.vendor ? { vendor: row.vendor } : {}),
        });
      });

      if (manual !== "") {
        const looksLikeUrl = /^https?:\/\//i.test(manual);
        newSources.push({
          id: `src-${Date.now()}-manual`,
          type: looksLikeUrl ? "url" : manual.includes("proxies:") ? "yaml" : "nodes",
          content: manual,
          tag: "手动内容",
        });
      }

      setSources(newSources);
      await parseMultipleSources(newSources);

      // 导入后，按「订阅配置的厂商」统一规整命名（国家优先使用 GeoIP 结果）
      await applySmartRename(newSources);

      toast({
        title: "导入并识别完成",
        description: `已成功解析并格式化了 ${useConfigStore.getState().nodes.length} 个节点。`,
      });
    } catch (err: unknown) {
      toast({
        title: "解析失败",
        description: err instanceof Error ? err.message : "无法解析提供的内容，请检查格式。",
        variant: "destructive",
      });
    } finally {
      setIsParsing(false);
    }
  };

  // 拉取节点落地国家（GeoIP）：节点名里通常不含国家信息，需要用服务器 IP 判断
  const fetchGeoByHost = React.useCallback(
    async (hosts: string[]): Promise<Map<string, { countryCode: string; country: string }>> => {
      const geoByHost = new Map<string, { countryCode: string; country: string }>();
      if (hosts.length === 0) return geoByHost;
      try {
        const res = await fetch(withBasePath("/api/geoip"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hosts }),
        });
        if (!res.ok) return geoByHost;
        const data = (await res.json()) as { results?: unknown };
        if (!Array.isArray(data.results)) return geoByHost;
        for (const item of data.results) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;
          const host = typeof record.host === "string" ? record.host.trim().toLowerCase() : "";
          const countryCode = typeof record.countryCode === "string" ? record.countryCode.trim() : "";
          if (!host || !countryCode) continue;
          geoByHost.set(host, {
            countryCode: countryCode.toUpperCase(),
            country: typeof record.country === "string" ? record.country : "",
          });
        }
      } catch {
        // GeoIP 失败时静默降级为名称识别
      }
      return geoByHost;
    },
    []
  );

  /**
   * 智能重命名：GeoIP 识别落地国家 + 订阅厂商 + 协议 + 序号
   */
  const applySmartRename = async (
    sourceList?: Array<{ id: string; vendor?: string }>
  ): Promise<void> => {
    const currentNodes = useConfigStore.getState().nodes;
    if (currentNodes.length === 0) return;

    const activeSources = sourceList ?? sources;
    const vendorResolver = makeVendorResolver(activeSources);

    const hosts = Array.from(
      new Set(
        currentNodes
          .map((node) => (typeof node.server === "string" ? node.server.trim().toLowerCase() : ""))
          .filter((host) => host !== "")
      )
    );
    const geoByHost = await fetchGeoByHost(hosts);

    const formatted = batchFormatNodesWithRegion(currentNodes, {
      regionResolver: (node) => {
        const host = typeof node.server === "string" ? node.server.trim().toLowerCase() : "";
        const geo = host ? geoByHost.get(host) : undefined;
        return geo ? regionFromGeo(geo.countryCode, geo.country) : undefined;
      },
      vendorResolver,
    });

    const updated = formatted.map(({ newName, node, oldName }) => {
      const rec = node as unknown as Record<string, unknown>;
      const host = typeof node.server === "string" ? node.server.trim().toLowerCase() : "";
      const geo = host ? geoByHost.get(host) : undefined;
      return {
        ...node,
        name: newName,
        _originName: rec["_originName"] || oldName,
        ...(geo
          ? { _geoCountry: geo.countryCode.toUpperCase(), _geoCountryName: geo.country }
          : {}),
      } as ParsedNode;
    });

    useConfigStore.setState({ nodes: updated });
    generateConfig();
    return;
  };

  // 一键重新格式化命名（含 GeoIP 国家识别）
  const handleReformatNames = async () => {
    if (nodes.length === 0) {
      toast({ title: "当前无节点", description: "请先导入节点再进行重命名。" });
      return;
    }
    setIsRenaming(true);
    try {
      await applySmartRename();
      const renamed = useConfigStore.getState().nodes;
      const geoCount = renamed.filter((node) => {
        const value = (node as unknown as Record<string, unknown>)["_geoCountry"];
        return typeof value === "string" && value !== "";
      }).length;
      toast({
        title: "节点已重新识别命名",
        description:
          geoCount > 0
            ? `已通过 GeoIP 识别 ${geoCount}/${renamed.length} 个节点的落地国家，示例：${renamed[0]?.name ?? ""}`
            : `未能识别落地国家（GeoIP 不可用），已按名称识别，示例：${renamed[0]?.name ?? ""}`,
      });
    } finally {
      setIsRenaming(false);
    }
  };

  // 清空所有节点
  const handleClearNodes = async () => {
    if (nodes.length === 0) return;
    const confirmed = await confirm({
      title: "清空所有节点？",
      description: "当前解析的所有节点将被全部移除。",
      variant: "destructive",
    });
    if (!confirmed) return;
    clearNodes();
    toast({ title: "已清空节点列表" });
  };

  // 保存当前配置
  const handleSaveConfig = async () => {
    const trimmedName = configName.trim();
    if (!trimmedName) {
      toast({
        title: "请输入配置名称",
        variant: "destructive",
      });
      return;
    }
    if (nodes.length === 0) {
      toast({
        title: "当前没有节点",
        description: "请先添加并解析至少一个节点后再保存配置。",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const urls = sourceRows.map((row) => row.url.trim()).filter(Boolean);
      // 订阅 → 厂商 映射，随配置一起保存，下次载入时回填
      const sourceVendors: Record<string, string> = {};
      for (const row of sourceRows) {
        const url = row.url.trim();
        const vendor = row.vendor.trim();
        if (url && vendor) sourceVendors[url] = vendor;
      }
      const isEditing = Boolean(currentSubId);
      const endpoint = isEditing
        ? withBasePath(`/api/subscriptions/${encodeURIComponent(currentSubId!)}`)
        : withBasePath("/api/subscriptions");
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          urls: urls.length > 0 ? urls : [manualContent.trim()].filter(Boolean),
          nodes,
          config: { sourceVendors },
          autoUpdateInterval: 86400, // 默认 24 小时
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "保存配置失败");
      }

      const resData = await res.json();
      const savedSub = resData.subscription;
      setCurrentSubId(savedSub.id);
      setCurrentSubToken(savedSub.token);
      await fetchSubscriptions();

      toast({
        title: isEditing ? "配置更新成功" : "配置创建成功",
        description: `配置「${trimmedName}」已保存，随时可复制生成的三种订阅链接。`,
      });

      // 保存成功自动唤起订阅链接对话框
      setLinkDialogOpen(true);
    } catch (err: unknown) {
      toast({
        title: "保存失败",
        description: err instanceof Error ? err.message : "请稍后重试。",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyConfig = async () => {
    if (!currentSubId) return;
    setIsApplying(true);
    try {
      const res = await fetch(withBasePath(`/api/subscriptions/${encodeURIComponent(currentSubId)}/apply`), {
        method: "POST",
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "应用配置失败");
      }
      await fetchSubscriptions();
      toast({ title: "配置已应用", description: "clash-config.yaml 已更新，订阅链接即刻生效。" });
    } catch (err: unknown) {
      toast({
        title: "应用失败",
        description: err instanceof Error ? err.message : "请稍后重试。",
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  };

  // 统计国家分布（优先使用 GeoIP 结果）
  const regionStats = React.useMemo(() => {
    const map = new Map<string, { label: string; emoji: string; count: number }>();
    for (const node of nodes) {
      const region = resolveNodeRegion(node as unknown as Record<string, unknown>);
      const existing = map.get(region.id) ?? { label: region.label, emoji: region.emoji, count: 0 };
      existing.count += 1;
      map.set(region.id, existing);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].count - a[1].count);
  }, [nodes]);

  // 筛选节点
  const filteredNodes = React.useMemo(() => {
    return nodes.filter((node) => {
      if (selectedRegionId !== "all") {
        const region = resolveNodeRegion(node as unknown as Record<string, unknown>);
        if (region.id !== selectedRegionId) return false;
      }
      if (searchKeyword.trim()) {
        const kw = searchKeyword.toLowerCase().trim();
        const matchesName = node.name.toLowerCase().includes(kw);
        const matchesServer = typeof node.server === "string" && node.server.toLowerCase().includes(kw);
        const matchesType = typeof node.type === "string" && node.type.toLowerCase().includes(kw);
        if (!matchesName && !matchesServer && !matchesType) return false;
      }
      return true;
    });
  }, [nodes, selectedRegionId, searchKeyword]);

  // 单节点改名完成
  const handleSaveNodeName = (oldName: string) => {
    const next = editingNodeName.trim();
    if (next && next !== oldName) {
      renameNode(oldName, next);
      generateConfig();
      toast({ title: "节点已重命名" });
    }
    setEditingNodeIndex(null);
  };

  // 构建三种订阅链接
  const getSubUrl = (format: "clash" | "v2rayn" | "base64") => {
    if (!currentSubToken) return "";
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const adminApi = withBasePath(`/api/subscriptions/${encodeURIComponent(currentSubToken)}/config.yaml`);
    return `${base}${adminApi}?type=${format}`;
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] w-full flex flex-col md:flex-row bg-[#0a0b0e] text-slate-100">
      {/* 左侧固定侧边栏 */}
      <aside className="w-full md:w-64 bg-neutral-950/80 backdrop-blur-xl border-b md:border-b-0 md:border-r border-white/10 flex flex-col shrink-0 p-4 space-y-6 select-none">
        {/* Logo 与系统标题 */}
        <div className="flex items-center gap-3 px-2 py-1">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center shadow-lg shadow-indigo-600/30 text-white font-bold">
            <Zap className="h-5 w-5 fill-white text-white" />
          </div>
          <div>
            <div className="font-bold text-white text-sm tracking-wide">SubBoost</div>
            <div className="text-[10px] text-white/40">订阅加速与住宅代理</div>
          </div>
        </div>

        {/* 导航菜单 */}
        <nav className="space-y-1.5 flex-1">
          <button
            type="button"
            onClick={() => setMainNav("subscriptions")}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all text-left",
              mainNav === "subscriptions"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/25"
                : "text-white/60 hover:text-white hover:bg-white/5"
            )}
          >
            <div className="flex items-center gap-2.5">
              <Layers className="h-4 w-4" />
              <span>订阅配置管理</span>
            </div>
            {subscriptions.length > 0 && (
              <span
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-md",
                  mainNav === "subscriptions" ? "bg-white/20 text-white" : "bg-white/5 text-white/40"
                )}
              >
                {subscriptions.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setMainNav("residential")}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all text-left",
              mainNav === "residential"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/25"
                : "text-white/60 hover:text-white hover:bg-white/5"
            )}
          >
            <div className="flex items-center gap-2.5">
              <Globe2 className="h-4 w-4 text-emerald-400" />
              <span>全球住宅节点池</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              全球
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMainNav("tunnels")}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all text-left",
              mainNav === "tunnels"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/25"
                : "text-white/60 hover:text-white hover:bg-white/5"
            )}
          >
            <div className="flex items-center gap-2.5">
              <Zap className="h-4 w-4 text-amber-400" />
              <span>已激活隧道管理</span>
            </div>
            {activeTunnelCount > 0 && (
              <Badge className="h-4 px-1.5 text-[10px] bg-emerald-500 text-black font-mono font-bold animate-pulse">
                {activeTunnelCount}
              </Badge>
            )}
          </button>

          <button
            type="button"
            onClick={() => setMainNav("settings")}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all text-left",
              mainNav === "settings"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/25"
                : "text-white/60 hover:text-white hover:bg-white/5"
            )}
          >
            <div className="flex items-center gap-2.5">
              <Settings className="h-4 w-4 text-indigo-300" />
              <span>系统与代理设置</span>
            </div>
          </button>
        </nav>

        {/* 侧边栏底部状态 */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between text-white/50">
            <span>主订阅直链</span>
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="font-mono text-emerald-400 truncate text-[10px]">
            https://clash.leozai.com
          </div>
        </div>
      </aside>

      {/* 右侧主工作面板 */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto">
        {mainNav === "residential" ? (
          <ResidentialPoolPanel
            onBackToConfig={() => setMainNav("subscriptions")}
            onSelectTunnelForConfig={(tunnel) => {
              setMainNav("subscriptions");
              setViewMode("edit");
              handleOpenResidentialDialog(tunnel);
            }}
            onGoToActiveTunnels={() => setMainNav("tunnels")}
          />
        ) : mainNav === "tunnels" ? (
          <ActiveTunnelsPanel
            onInjectTunnelToConfig={(tunnel) => {
              setMainNav("subscriptions");
              setViewMode("edit");
              handleOpenResidentialDialog(tunnel);
            }}
            onGoToResidentialPool={() => setMainNav("residential")}
          />
        ) : mainNav === "settings" ? (
          <SettingsPanel />
        ) : viewMode === "list" ? (
          /* ========== 列表页视图 ========== */
          <div className="space-y-6">
          {/* 列表页顶部 Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
            <div>
              <h1 className="text-xl font-bold text-white flex items-center gap-2">
                <Layers className="h-6 w-6 text-indigo-400" />
                订阅配置管理
              </h1>
              <p className="text-xs text-white/50 mt-1">
                管理您的所有订阅配置，已应用的配置将实时生效至主订阅链接 (clash.leozai.com)
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchSubscriptions}
                disabled={isLoadingList}
                className="h-9 border-white/10 hover:bg-white/5 text-white/80"
              >
                <RefreshCw className={cn("h-4 w-4 mr-1.5", isLoadingList && "animate-spin")} />
                刷新
              </Button>
              <Button
                onClick={handleOpenCreate}
                className="h-9 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                新建配置
              </Button>
            </div>
          </div>

          {/* 列表主体 */}
          {isLoadingList && subscriptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-white/40">
              <Loader2 className="h-8 w-8 animate-spin mb-3 text-indigo-400" />
              <p className="text-sm">正在加载配置列表...</p>
            </div>
          ) : subscriptions.length === 0 ? (
            <Card className="border-white/10 bg-black/30 backdrop-blur-md text-center py-16 px-4">
              <CardContent className="flex flex-col items-center max-w-sm mx-auto">
                <Layers className="h-12 w-12 text-white/20 mb-4" />
                <h3 className="text-base font-semibold text-white/90 mb-1">暂无订阅配置</h3>
                <p className="text-xs text-white/40 mb-6">
                  您还没有创建任何订阅配置。点击下方按钮开始导入并生成您的第一个配置。
                </p>
                <Button
                  onClick={handleOpenCreate}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  创建第一个配置
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {subscriptions.map((sub) => (
                <Card
                  key={sub.id}
                  className={cn(
                    "border-white/10 bg-black/40 backdrop-blur-md flex flex-col justify-between transition-all duration-200 hover:border-white/20",
                    sub.isPrimary && "border-emerald-500/40 shadow-lg shadow-emerald-500/5 bg-emerald-950/10"
                  )}
                >
                  <CardHeader className="pb-3 border-b border-white/5">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base font-semibold text-white/90 truncate flex-1" title={sub.name}>
                        {sub.name}
                      </CardTitle>
                      {sub.isPrimary ? (
                        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[11px] shrink-0">
                          ⚡ 已应用主订阅
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-white/10 text-white/40 text-[10px] shrink-0">
                          未应用
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="py-3 text-xs text-white/50 space-y-1.5 flex-1">
                    <div className="flex items-center justify-between">
                      <span>更新时间：</span>
                      <span className="font-mono text-white/70">
                        {sub.updatedAt ? new Date(sub.updatedAt).toLocaleString("zh-CN") : "刚刚"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>支持格式：</span>
                      <span className="text-white/70">Clash / v2rayN / 通用明文</span>
                    </div>
                  </CardContent>
                  <div className="p-3 border-t border-white/5 flex items-center justify-between gap-2">
                    <div>
                      {sub.isPrimary ? (
                        <span className="text-xs text-emerald-400 font-medium px-2 py-1 bg-emerald-500/10 rounded border border-emerald-500/20">
                          已应用 ✓
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleApplyById(sub.id, sub.name)}
                          disabled={isApplying}
                          className="h-8 text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                        >
                          <Zap className="h-3.5 w-3.5 mr-1" />
                          应用
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenEdit(sub.id)}
                        className="h-8 text-xs border-white/10 hover:bg-white/5 text-white/80"
                      >
                        <Edit2 className="h-3.5 w-3.5 mr-1" />
                        详情配置
                      </Button>
                      <IconButton
                        label="获取订阅链接"
                        variant="ghost"
                        onClick={() => handleOpenLinkDialogForSub(sub)}
                        className="h-8 w-8 text-indigo-300 hover:bg-indigo-500/10"
                      >
                        <LinkIcon className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        label="删除此配置"
                        variant="ghost"
                        onClick={() => handleDeleteById(sub.id, sub.name)}
                        className="h-8 w-8 text-white/30 hover:text-rose-400 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ========== 详情配置页视图 ========== */
        <div className="space-y-6">
          {/* 详情页顶部操作卡片 */}
          <Card className="border-white/10 bg-black/40 backdrop-blur-md">
            <CardContent className="p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBackToList}
                  className="h-9 border-white/10 hover:bg-white/5 text-white/80 shrink-0"
                >
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  返回列表
                </Button>

                <div className="flex items-center gap-2 flex-1 max-w-sm">
                  <Input
                    value={configName}
                    onChange={(e) => setConfigName(e.target.value)}
                    placeholder="配置名称"
                    className="h-9 text-sm bg-white/5 border-white/10"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNewConfig}
                  className="h-9 border-white/10 hover:bg-white/5"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  清空新建
                </Button>

                {currentSubId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteConfig}
                    className="h-9 border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    删除配置
                  </Button>
                )}

                <Button
                  onClick={handleSaveConfig}
                  disabled={isSaving || nodes.length === 0}
                  className="h-9 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <Save className="h-4 w-4 mr-1.5" />
                  )}
                  {currentSubId ? "保存更新" : "保存配置"}
                </Button>

                {currentSubId && (
                  (() => {
                    const isApplied = subscriptions.find((s) => s.id === currentSubId)?.isPrimary;
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleApplyConfig}
                        disabled={isApplying}
                        className={cn(
                          "h-9",
                          isApplied
                            ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20"
                            : "border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                        )}
                      >
                        {isApplying ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        ) : (
                          <Zap className="h-4 w-4 mr-1.5" />
                        )}
                        {isApplied ? "已应用 ✓" : "应用"}
                      </Button>
                    );
                  })()
                )}

                {currentSubToken && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLinkDialogOpen(true)}
                    className="h-9 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10"
                  >
                    <LinkIcon className="h-4 w-4 mr-1.5" />
                    订阅链接
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

      {/* 主体区：上部输入源，下部节点列表 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* 左侧/上方：输入源与操作面板 */}
        <Card className="lg:col-span-4 border-white/10 bg-black/40 backdrop-blur-md flex flex-col">
          <CardHeader className="pb-3 border-b border-white/5">
            <CardTitle className="text-sm font-semibold flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FolderPlus className="h-4 w-4 text-indigo-400" />
                添加订阅（一行一个）
              </span>
              <span className="text-xs font-normal text-white/40">可设置厂商</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              {sourceRows.map((row, idx) => (
                <div
                  key={row.id}
                  className="space-y-1.5 rounded-lg border border-white/5 bg-white/[0.02] p-2"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 shrink-0 text-center text-[10px] text-white/30">{idx + 1}</span>
                    <Input
                      value={row.url}
                      onChange={(e) => updateSourceRow(row.id, { url: e.target.value })}
                      placeholder="订阅链接，如 https://example.com/sub"
                      aria-label={`第 ${idx + 1} 个订阅链接`}
                      className="h-8 flex-1 font-mono text-xs bg-white/5 border-white/10"
                    />
                    <IconButton
                      label="移除该订阅"
                      variant="ghost"
                      onClick={() => removeSourceRow(row.id)}
                      className="h-7 w-7 shrink-0 text-white/30 hover:text-rose-400 hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 shrink-0 text-center text-[10px] text-white/30">厂</span>
                    <Input
                      value={row.vendor}
                      onChange={(e) => updateSourceRow(row.id, { vendor: e.target.value })}
                      placeholder="厂商（可选，如 阿里云）"
                      aria-label={`第 ${idx + 1} 个订阅的厂商`}
                      className="h-8 flex-1 text-xs bg-white/5 border-white/10"
                    />
                  </div>
                </div>
              ))}

              <Button
                variant="outline"
                size="sm"
                onClick={() => setSourceRows((prev) => [...prev, createEmptyRow()])}
                className="w-full h-8 text-xs border-dashed border-white/10 hover:bg-white/5 text-white/70"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                添加一行订阅
              </Button>

              <p className="text-[11px] text-white/40">
                每行填写一个订阅链接，厂商会作为 <code className="text-emerald-300">[厂商]</code> 标记写入该订阅导入的全部节点名。
              </p>
            </div>

            {/* 手动粘贴节点 / YAML */}
            <div className="space-y-1.5">
              <p className="text-[11px] text-white/50">或直接粘贴节点链接 / YAML（可选）</p>
              <Textarea
                value={manualContent}
                onChange={(e) => setManualContent(e.target.value)}
                placeholder={`支持单节点链接（hysteria2://、vmess://、ss://、vless://、trojan://）、Base64 节点集合或 Clash YAML 片段`}
                className="h-24 resize-none font-mono text-xs bg-white/5 border-white/10 leading-relaxed custom-scrollbar"
              />
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <Button
                onClick={handleImport}
                disabled={
                  isParsing ||
                  (sourceRows.every((row) => !row.url.trim()) && !manualContent.trim())
                }
                className="w-full h-9 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
              >
                {isParsing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    正在解析与识别...
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 mr-2" />
                    🚀 解析并导入源
                  </>
                )}
              </Button>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReformatNames}
                  disabled={nodes.length === 0 || isRenaming}
                  className="h-8 text-xs border-white/10 hover:bg-white/5 text-white/80"
                  title="按节点服务器 IP 识别落地国家：格式形如 🇺🇸美国-hysteria2-01[阿里云]"
                >
                  {isRenaming ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin text-emerald-400" />
                  ) : (
                    <Globe2 className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                  )}
                  {isRenaming ? "识别国家中..." : "智能重命名"}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearNodes}
                  disabled={nodes.length === 0}
                  className="h-8 text-xs border-white/10 hover:bg-rose-500/10 text-rose-300 hover:text-rose-200"
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  清空节点
                </Button>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenResidentialDialog()}
                className="w-full h-8 text-xs border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15 text-emerald-300 font-medium transition-colors"
              >
                <Globe2 className="h-3.5 w-3.5 mr-1.5 text-emerald-400" />
                🌐 引入住宅落地节点 (dialer-proxy)
              </Button>
            </div>

            {/* 命名格式小提示 */}
            <div className="rounded-lg bg-white/5 border border-white/5 p-3 space-y-1 text-xs text-white/60">
              <p className="font-medium text-white/80">💡 自动识别规则：</p>
              <p className="text-[11px] leading-relaxed">
                按节点服务器 IP 做 GeoIP 查询识别落地国家，再拼上国旗 Emoji、协议类型、同组序号和订阅厂商标签，生成如：
                <code className="block mt-1 p-1 rounded bg-black/40 text-emerald-300 font-mono text-[11px]">
                  🇺🇸美国-hysteria2-01[阿里云]
                </code>
                <span className="block mt-1 text-white/40">
                  节点名里没有国家信息时也能识别；若 GeoIP 服务不可用则回退为按节点名识别。
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 右侧/主体：节点列表展示（彻底代替原本繁复的 YAML 预览） */}
        <Card className="lg:col-span-8 border-white/10 bg-black/40 backdrop-blur-md flex flex-col min-h-[560px]">
          <CardHeader className="pb-3 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Server className="h-4 w-4 text-emerald-400" />
                节点列表
              </CardTitle>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-xs">
                {nodes.length} 个节点
              </Badge>
            </div>

            {/* 搜索框 */}
            <div className="relative w-full md:w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-white/40" />
              <Input
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索名称、IP 或协议..."
                className="h-8 pl-8 text-xs bg-white/5 border-white/10"
              />
              {searchKeyword && (
                <IconButton
                  label="清除搜索"
                  variant="ghost"
                  onClick={() => setSearchKeyword("")}
                  className="absolute right-1.5 top-1.5 h-5 w-5 text-white/40 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </IconButton>
              )}
            </div>
          </CardHeader>

          {/* 国家分布筛选胶囊 */}
          {regionStats.length > 0 && (
            <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedRegionId("all")}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap",
                  selectedRegionId === "all"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-white/5 text-white/60 hover:text-white hover:bg-white/10"
                )}
              >
                全部 ({nodes.length})
              </button>
              {regionStats.map(([id, stat]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedRegionId(id)}
                  className={cn(
                    "px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap",
                    selectedRegionId === id
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-white/5 text-white/60 hover:text-white hover:bg-white/10"
                  )}
                >
                  <span>{stat.emoji}</span>
                  <span>{stat.label}</span>
                  <span className="text-[10px] opacity-70">({stat.count})</span>
                </button>
              ))}
            </div>
          )}

          <CardContent className="p-4 flex-1 flex flex-col">
            {filteredNodes.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-16 text-center text-white/40 space-y-2">
                <Server className="h-10 w-10 opacity-30 stroke-[1.5]" />
                <p className="text-sm font-medium">
                  {nodes.length === 0 ? "暂无节点" : "没有符合条件的节点"}
                </p>
                <p className="text-xs text-white/30 max-w-sm">
                  {nodes.length === 0
                    ? "请在左侧文本框粘贴订阅链接或节点，点击【解析并导入源】生成节点列表。"
                    : "请尝试更改筛选条件或清空搜索关键词。"}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredNodes.map((node, idx) => {
                  const isEditing = editingNodeIndex === idx;
                  const nodeType = typeof node.type === "string" ? node.type : "node";
                  const serverInfo =
                    node.server && node.port ? `${node.server}:${node.port}` : node.server || "";

                  return (
                    <div
                      key={`${node.name}-${idx}`}
                      className="group flex flex-col sm:flex-row sm:items-center justify-between p-2.5 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10 transition-all gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {isEditing ? (
                          <div className="flex items-center gap-2 flex-1">
                            <Input
                              value={editingNodeName}
                              onChange={(e) => setEditingNodeName(e.target.value)}
                              autoFocus
                              className="h-7 text-xs bg-white/10 border-white/20"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveNodeName(node.name);
                                if (e.key === "Escape") setEditingNodeIndex(null);
                              }}
                            />
                            <IconButton
                              label="保存"
                              variant="ghost"
                              onClick={() => handleSaveNodeName(node.name)}
                              className="h-7 w-7 text-emerald-400 hover:text-emerald-300"
                            >
                              <Check className="h-4 w-4" />
                            </IconButton>
                            <IconButton
                              label="取消"
                              variant="ghost"
                              onClick={() => setEditingNodeIndex(null)}
                              className="h-7 w-7 text-white/40 hover:text-white"
                            >
                              <X className="h-4 w-4" />
                            </IconButton>
                          </div>
                        ) : (
                          <>
                            <span className="font-mono text-sm font-medium text-white/90 truncate">
                              {node.name}
                            </span>
                            <IconButton
                              label="修改节点名称"
                              variant="ghost"
                              onClick={() => {
                                setEditingNodeIndex(idx);
                                setEditingNodeName(node.name);
                              }}
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 text-white/40 hover:text-white transition-opacity"
                            >
                              <Edit2 className="h-3 w-3" />
                            </IconButton>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        {serverInfo && (
                          <span className="font-mono text-[11px] text-white/40 truncate max-w-[180px]">
                            {serverInfo}
                          </span>
                        )}

                        {Boolean((node as unknown as Record<string, unknown>)["dialer-proxy"]) && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 font-mono bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                          >
                            🔗 落地 (前置: {String((node as unknown as Record<string, unknown>)["dialer-proxy"])})
                          </Badge>
                        )}

                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-1.5 py-0 uppercase font-mono border-white/10",
                            nodeType === "hysteria2" && "bg-purple-500/10 text-purple-300 border-purple-500/30",
                            nodeType === "vmess" && "bg-blue-500/10 text-blue-300 border-blue-500/30",
                            nodeType === "vless" && "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
                            nodeType === "trojan" && "bg-amber-500/10 text-amber-300 border-amber-500/30",
                            nodeType === "ss" && "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                          )}
                        >
                          {nodeType}
                        </Badge>

                        <IconButton
                          label="删除该节点"
                          variant="ghost"
                          onClick={() => {
                            removeNode(node.name);
                            generateConfig();
                            toast({ title: "已移除该节点" });
                          }}
                          className="h-7 w-7 text-white/30 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
        </div>
      )}
      </main>

      {/* 订阅链接展示弹窗（生成三种链接） */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-lg border-white/10 bg-neutral-900/95 backdrop-blur-xl text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <LinkIcon className="h-5 w-5 text-indigo-400" />
              配置订阅链接已生成
            </DialogTitle>
            <DialogDescription className="text-white/60 text-xs">
              配置「{configName}」已就绪，以下三种格式均可直接复制并在对应客户端中使用。
            </DialogDescription>
          </DialogHeader>

          <div className="py-3 space-y-4">
            <Tabs defaultValue="clash" className="w-full">
              <TabsList className="grid grid-cols-3 h-9 bg-white/5 border border-white/10">
                <TabsTrigger value="clash" className="text-xs">Clash 配置</TabsTrigger>
                <TabsTrigger value="v2rayn" className="text-xs">v2rayN (Base64)</TabsTrigger>
                <TabsTrigger value="base64" className="text-xs">通用明文链接</TabsTrigger>
              </TabsList>

              {(["clash", "v2rayn", "base64"] as const).map((fmt) => {
                const url = getSubUrl(fmt);
                const isCopied = copiedType === fmt;

                return (
                  <TabsContent key={fmt} value={fmt} className="mt-3 space-y-3">
                    <div className="flex gap-2">
                      <Input
                        value={url}
                        readOnly
                        className="font-mono text-xs bg-white/5 border-white/10 select-all"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await navigator.clipboard.writeText(url);
                          setCopiedType(fmt);
                          toast({ title: "链接已复制到剪贴板" });
                          setTimeout(() => setCopiedType(null), 2000);
                        }}
                        className="flex-shrink-0 border-white/10 hover:bg-white/10"
                      >
                        {isCopied ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-400 mr-1.5" />
                            已复制
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5 mr-1.5" />
                            复制链接
                          </>
                        )}
                      </Button>
                    </div>

                    <div className="p-3 rounded-lg bg-white/5 border border-white/5 text-xs text-white/50 space-y-1">
                      {fmt === "clash" && (
                        <p>💡 适用客户端：Clash Verge, Clash Meta (Mihomo), Clash for Windows, ClashX Meta 等。</p>
                      )}
                      {fmt === "v2rayn" && (
                        <p>💡 适用客户端：v2rayN, v2rayNG, Shadowrocket 等支持 Base64 订阅聚合的工具。</p>
                      )}
                      {fmt === "base64" && (
                        <p>💡 适用客户端：通用单节点明文换行列表（ss/vmess/vless/trojan/hy2），便于批量复制或导入。</p>
                      )}
                    </div>
                  </TabsContent>
                );
              })}
            </Tabs>
          </div>

          <DialogFooter>
            <Button
              onClick={() => setLinkDialogOpen(false)}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              完成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 引入住宅落地节点弹窗 */}
      <Dialog open={residentialDialogOpen} onOpenChange={setResidentialDialogOpen}>
        <DialogContent className="sm:max-w-lg border-white/10 bg-neutral-900/95 backdrop-blur-xl text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Globe2 className="h-5 w-5 text-emerald-400" />
              引入住宅落地节点
            </DialogTitle>
            <DialogDescription className="text-white/60 text-xs">
              将服务器守护的 OpenVPN 住宅出口注入到当前订阅配置中，支持中转链式中转与直连双模式。
            </DialogDescription>
          </DialogHeader>

          <div className="py-3 space-y-4 text-xs">
            {isLoadingActiveTunnels ? (
              <div className="flex items-center justify-center py-8 text-white/40 gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                正在加载活跃隧道...
              </div>
            ) : activeTunnels.length === 0 ? (
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 space-y-2">
                <p className="font-medium">⚠️ 暂无运行中的住宅隧道</p>
                <p className="text-[11px] text-amber-200/70">
                  当前服务器尚未启动任何住宅隧道。请先前往「全球住宅节点池」启动一个隧道后再引入。
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    setResidentialDialogOpen(false);
                    setMainNav("residential");
                  }}
                  className="h-7 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40"
                >
                  前往启动住宅隧道
                </Button>
              </div>
            ) : (
              <>
                {/* 模式选择 */}
                <div className="space-y-1.5">
                  <label className="text-white/70 font-medium">1. 选择接入落地模式</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setResidentialMode("transit")}
                      className={cn(
                        "p-2.5 rounded-lg border text-left transition-all",
                        residentialMode === "transit"
                          ? "border-emerald-500/50 bg-emerald-500/10 text-white shadow-sm"
                          : "border-white/10 bg-white/5 text-white/60 hover:border-white/20"
                      )}
                    >
                      <div className="font-medium text-xs flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        链式中转落地 (dialer-proxy)
                      </div>
                      <div className="text-[10px] text-white/40 mt-1 leading-tight">
                        前置机场节点连接 VPS 公网端口，再由住宅隧道送出，兼顾高速与住宅 IP
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setResidentialMode("direct")}
                      className={cn(
                        "p-2.5 rounded-lg border text-left transition-all",
                        residentialMode === "direct"
                          ? "border-emerald-500/50 bg-emerald-500/10 text-white shadow-sm"
                          : "border-white/10 bg-white/5 text-white/60 hover:border-white/20"
                      )}
                    >
                      <div className="font-medium text-xs flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-indigo-400" />
                        直连公网落地
                      </div>
                      <div className="text-[10px] text-white/40 mt-1 leading-tight">
                        客户端直接连接 VPS 对应端口，无需配置前置节点，适合直连网络畅通场景
                      </div>
                    </button>
                  </div>
                </div>

                {/* 活跃隧道选择 */}
                <div className="space-y-1.5">
                  <label className="text-white/70 font-medium">2. 选择活跃住宅隧道</label>
                  <select
                    value={selectedTunnelId}
                    onChange={(e) => setSelectedTunnelId(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-emerald-500 font-mono"
                  >
                    {activeTunnels.map((t) => {
                      const reg = regionFromGeo(t.country, t.country);
                      return (
                        <option key={t.id} value={t.id} className="bg-neutral-900 text-white">
                          {reg.emoji} {reg.label} ({t.ip}) - 公网端口 :{t.port} [{t.tun}]
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* 前置节点选择 (仅在 transit 模式需要) */}
                {residentialMode === "transit" && (
                  <div className="space-y-1.5">
                    <label className="text-white/70 font-medium">3. 选择前置中转节点 (dialer-proxy)</label>
                    {nodes.filter((n) => !(n as unknown as Record<string, unknown>)["_isResidential"]).length === 0 ? (
                      <p className="text-rose-400 text-[11px]">
                        当前配置中暂无可用前置节点，请先在下方解析并导入至少一个常规代理节点。
                      </p>
                    ) : (
                      <select
                        value={selectedDialerProxy}
                        onChange={(e) => setSelectedDialerProxy(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-emerald-500 font-mono"
                      >
                        <option value="" disabled className="bg-neutral-900 text-white/50">
                          -- 请选择前置中转节点 --
                        </option>
                        {nodes
                          .filter((n) => !(n as unknown as Record<string, unknown>)["_isResidential"])
                          .map((n) => (
                            <option key={n.name} value={n.name} className="bg-neutral-900 text-white">
                              {n.name} ({n.type})
                            </option>
                          ))}
                      </select>
                    )}
                    <p className="text-[11px] text-white/40">
                      前置节点将负责中转连接到 VPS 真实公网 IP 及对应端口。
                    </p>
                  </div>
                )}

                <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-white/60 space-y-1 text-[11px]">
                  <p className="font-semibold text-emerald-400">🛡️ 端口与安全状态：</p>
                  <p>• 节点连接地址将自动使用服务器公网 IP，SOCKS5 认证账号已内嵌。</p>
                  <p>• 经测试确认支持 Clash Verge / Meta 链式代理与标准 SOCKS5 客户端。</p>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between sm:justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResidentialDialogOpen(false)}
              className="border-white/10 hover:bg-white/5 text-white/80"
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmAddResidentialNode}
              disabled={
                isLoadingActiveTunnels ||
                activeTunnels.length === 0 ||
                !selectedTunnelId ||
                (residentialMode === "transit" && !selectedDialerProxy)
              }
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              确认引入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

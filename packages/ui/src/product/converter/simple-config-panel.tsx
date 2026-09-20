"use client";

import * as React from "react";
import {
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
  Save,
  Search,
  Server,
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
import { batchFormatNodesWithRegion, detectNodeRegion } from "@subboost/core/node-region-formatter";
import type { ParsedNode } from "@subboost/core/types/node";
import { cn } from "@subboost/ui/lib/utils";

type SubscriptionItem = {
  id: string;
  name: string;
  token: string;
  autoUpdateInterval?: number | null;
  updatedAt?: string;
};

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

  // 配置列表状态
  const [subscriptions, setSubscriptions] = React.useState<SubscriptionItem[]>([]);
  const [isLoadingList, setIsLoadingList] = React.useState(false);
  const [currentSubId, setCurrentSubId] = React.useState<string | null>(null);
  const [currentSubToken, setCurrentSubToken] = React.useState<string | null>(null);

  // 表单状态
  const [configName, setConfigName] = React.useState("我的主力配置");
  const [inputContent, setInputContent] = React.useState("");
  const [isParsing, setIsParsing] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

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
        if (Array.isArray(sub.urls) && sub.urls.length > 0) {
          setInputContent(sub.urls.join("\n"));
        } else {
          setInputContent("");
        }
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
    setInputContent("");
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
      setInputContent("");
      await fetchSubscriptions();
    } catch (err: unknown) {
      toast({
        title: "删除失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    }
  };

  // 解析并导入源
  const handleImport = async () => {
    const trimmed = inputContent.trim();
    if (!trimmed) {
      toast({
        title: "请输入订阅或节点内容",
        description: "支持粘贴订阅链接、单节点链接（vmess/vless/hysteria2/ss等）或 YAML 内容。",
        variant: "destructive",
      });
      return;
    }

    setIsParsing(true);
    try {
      const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
      const isPureUrls = lines.every((line) => line.startsWith("http://") || line.startsWith("https://"));

      const newSources = isPureUrls
        ? lines.map((url, idx) => ({
            id: `src-${Date.now()}-${idx}`,
            type: "url" as const,
            content: url,
            tag: `源 ${idx + 1}`,
          }))
        : [
            {
              id: `src-${Date.now()}-0`,
              type: trimmed.includes("proxies:") ? ("yaml" as const) : ("url" as const),
              content: trimmed,
              tag: "混合源",
            },
          ];

      setSources(newSources);
      await parseMultipleSources();

      // 导入后，自动执行智能规整命名
      const currentNodes = useConfigStore.getState().nodes;
      if (currentNodes.length > 0) {
        const formatted = batchFormatNodesWithRegion(currentNodes);
        const updated = formatted.map(({ newName, node, oldName }) => {
          const rec = node as unknown as Record<string, unknown>;
          return {
            ...node,
            name: newName,
            _originName: rec["_originName"] || oldName,
          } as ParsedNode;
        });
        useConfigStore.setState({ nodes: updated });
        generateConfig();
      }

      toast({
        title: "导入并识别完成",
        description: `已成功解析并按国家、协议、厂商格式化了 ${useConfigStore.getState().nodes.length} 个节点。`,
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

  // 一键重新格式化命名
  const handleReformatNames = () => {
    if (nodes.length === 0) {
      toast({ title: "当前无节点", description: "请先导入节点再进行重命名。" });
      return;
    }
    const formatted = batchFormatNodesWithRegion(nodes);
    const updated = formatted.map(({ newName, node, oldName }) => {
      const rec = node as unknown as Record<string, unknown>;
      return {
        ...node,
        name: newName,
        _originName: rec["_originName"] || oldName,
      } as ParsedNode;
    });
    useConfigStore.setState({ nodes: updated });
    generateConfig();
    toast({
      title: "节点已全部重新识别重命名",
      description: `格式如：${updated[0]?.name ?? "🇺🇸美国-hysteria2-01[阿里云]"}`,
    });
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
      const urls = sources.map((s) => s.content.trim()).filter(Boolean);
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
          urls: urls.length > 0 ? urls : [inputContent.trim()],
          nodes,
          config: {},
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

  // 统计国家分布
  const regionStats = React.useMemo(() => {
    const map = new Map<string, { label: string; emoji: string; count: number }>();
    for (const node of nodes) {
      const region = detectNodeRegion(node.name);
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
        const region = detectNodeRegion(node.name);
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
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* 顶部多配置管理栏 */}
      <Card className="border-white/10 bg-black/40 backdrop-blur-md">
        <CardContent className="p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div className="flex flex-1 items-center gap-3 flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-2 text-indigo-400">
              <Layers className="h-5 w-5" />
              <span className="font-semibold text-sm whitespace-nowrap">当前配置:</span>
            </div>

            {/* 配置选择器 */}
            <div className="relative flex-1 max-w-xs">
              <select
                aria-label="选择配置"
                value={currentSubId || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) handleSelectSubscription(val);
                }}
                className="w-full h-9 rounded-lg bg-white/5 border border-white/10 px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 appearance-none cursor-pointer"
              >
                <option value="" disabled className="bg-neutral-900 text-white/50">
                  {currentSubId ? "选择已有配置..." : "➕ 新建未命名配置"}
                </option>
                {subscriptions.map((sub) => (
                  <option key={sub.id} value={sub.id} className="bg-neutral-900 text-white">
                    {sub.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-2.5 h-4 w-4 text-white/40 pointer-events-none" />
            </div>

            {/* 配置名称快速修改 */}
            <Input
              value={configName}
              onChange={(e) => setConfigName(e.target.value)}
              placeholder="配置名称"
              className="h-9 w-44 md:w-56 text-sm bg-white/5 border-white/10"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewConfig}
              className="h-9 border-white/10 hover:bg-white/5"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              新建配置
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
                添加订阅 / 节点 / YAML
              </span>
              <span className="text-xs font-normal text-white/40">支持混合输入</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="space-y-1.5">
              <Textarea
                value={inputContent}
                onChange={(e) => setInputContent(e.target.value)}
                placeholder={`支持在此输入：\n1. 订阅链接 (如 https://example.com/sub)\n2. 单节点链接 (如 hysteria2://, vmess://, ss://, vless://, trojan://)\n3. Base64 编码的节点集合\n4. Clash YAML 配置代码片段`}
                className="h-48 resize-none font-mono text-xs bg-white/5 border-white/10 leading-relaxed custom-scrollbar"
              />
              <p className="text-[11px] text-white/40">
                可一次性粘贴多行内容，系统将自动识别并去重。
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <Button
                onClick={handleImport}
                disabled={isParsing || !inputContent.trim()}
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
                  disabled={nodes.length === 0}
                  className="h-8 text-xs border-white/10 hover:bg-white/5 text-white/80"
                  title="格式形如：🇺🇸美国-hysteria2-01[阿里云]"
                >
                  <Globe2 className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                  智能重命名
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
            </div>

            {/* 命名格式小提示 */}
            <div className="rounded-lg bg-white/5 border border-white/5 p-3 space-y-1 text-xs text-white/60">
              <p className="font-medium text-white/80">💡 自动识别规则：</p>
              <p className="text-[11px] leading-relaxed">
                导入时自动识别国家并附带国旗 Emoji、协议类型、同组序号和云厂商标签，生成如：
                <code className="block mt-1 p-1 rounded bg-black/40 text-emerald-300 font-mono text-[11px]">
                  🇺🇸美国-hysteria2-01[阿里云]
                </code>
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
    </div>
  );
}

"use client";

import * as React from "react";
import {
  Activity,
  ArrowLeft,
  Check,
  Globe2,
  Layers,
  Loader2,
  Power,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import { Input } from "@subboost/ui/components/ui/input";
import { Badge } from "@subboost/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { withBasePath } from "@subboost/ui/lib/base-path";
import { regionFromGeo } from "@subboost/core/node-region-formatter";
import { cn } from "@subboost/ui/lib/utils";

export type VpngateNodeItem = {
  id: string;
  hostname: string;
  ip: string;
  countryShort: string;
  countryLong: string;
  ping: number;
  speed: number;
  score: number;
  operator: string;
  message: string;
  ipType: string;
  openvpnConfigBase64: string;
  reachable?: boolean;
  latencyMs?: number;
};

export type ActiveTunnelItem = {
  id: string;
  hostname: string;
  ip: string;
  country: string;
  tun: string;
  port: number;
  tableId: number;
  alive: boolean;
  startTime: number;
};

interface ResidentialPoolPanelProps {
  onBackToConfig: () => void;
  onSelectTunnelForConfig?: (tunnel: ActiveTunnelItem) => void;
}

export function ResidentialPoolPanel({
  onBackToConfig,
  onSelectTunnelForConfig,
}: ResidentialPoolPanelProps) {
  const { toast } = useToast();
  const [nodes, setNodes] = React.useState<VpngateNodeItem[]>([]);
  const [tunnels, setTunnels] = React.useState<ActiveTunnelItem[]>([]);
  const [isLoadingNodes, setIsLoadingNodes] = React.useState(false);
  const [isLoadingTunnels, setIsLoadingTunnels] = React.useState(false);
  const [operatingId, setOperatingId] = React.useState<string | null>(null);

  // 筛选状态
  const [countryFilter, setCountryFilter] = React.useState<string>("all");
  const [searchKeyword, setSearchKeyword] = React.useState<string>("");
  const [onlyResidential, setOnlyResidential] = React.useState<boolean>(false);

  // 获取活跃隧道
  const fetchTunnels = React.useCallback(async () => {
    setIsLoadingTunnels(true);
    try {
      const res = await fetch(withBasePath("/api/vpngate/tunnels"), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tunnels)) {
          setTunnels(data.tunnels);
        }
      }
    } catch {
      // 忽略初次加载错误
    } finally {
      setIsLoadingTunnels(false);
    }
  }, []);

  // 获取 VPNGate 节点
  const fetchNodes = React.useCallback(
    async (force = false) => {
      setIsLoadingNodes(true);
      try {
        const res = await fetch(withBasePath(`/api/vpngate/nodes?refresh=${force ? 1 : 0}`), {
          cache: "no-store",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "获取住宅节点失败");
        }
        const data = await res.json();
        if (Array.isArray(data.nodes)) {
          setNodes(data.nodes);
          if (force) {
            toast({
              title: "节点列表已刷新",
              description: `成功获取并探活 ${data.nodes.length} 个全球住宅节点。`,
            });
          }
        }
      } catch (err: unknown) {
        toast({
          title: "拉取节点失败",
          description: err instanceof Error ? err.message : "请稍后重试",
          variant: "destructive",
        });
      } finally {
        setIsLoadingNodes(false);
      }
    },
    [toast]
  );

  React.useEffect(() => {
    fetchNodes(false);
    fetchTunnels();
  }, [fetchNodes, fetchTunnels]);

  // 启动隧道
  const handleStartTunnel = async (node: VpngateNodeItem) => {
    setOperatingId(node.id);
    try {
      const res = await fetch(withBasePath("/api/vpngate/tunnels"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "启动隧道失败");
      }
      toast({
        title: "住宅隧道已建立",
        description: `本地回环端口 127.0.0.1:${data.tunnel.port} 已就绪，公网无端口暴露。`,
      });
      await fetchTunnels();
    } catch (err: unknown) {
      toast({
        title: "启动失败",
        description: err instanceof Error ? err.message : "请检查服务器权限与网络环境",
        variant: "destructive",
      });
    } finally {
      setOperatingId(null);
    }
  };

  // 停止隧道
  const handleStopTunnel = async (nodeId: string) => {
    setOperatingId(nodeId);
    try {
      const res = await fetch(withBasePath(`/api/vpngate/tunnels/${encodeURIComponent(nodeId)}`), {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "停止隧道失败");
      }
      toast({ title: "隧道已断开", description: "本地回环端口已释放。" });
      await fetchTunnels();
    } catch (err: unknown) {
      toast({
        title: "操作失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setOperatingId(null);
    }
  };

  // 统计国家列表
  const countries = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const node of nodes) {
      const c = node.countryShort || "OTHER";
      map.set(c, (map.get(c) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  // 过滤节点
  const filteredNodes = React.useMemo(() => {
    return nodes.filter((node) => {
      if (countryFilter !== "all" && node.countryShort !== countryFilter) return false;
      if (onlyResidential && !node.ipType.includes("住宅") && !node.ipType.includes("教育网"))
        return false;
      if (searchKeyword.trim()) {
        const q = searchKeyword.trim().toLowerCase();
        const matchIp = node.ip.toLowerCase().includes(q);
        const matchHost = node.hostname.toLowerCase().includes(q);
        const matchOp = node.operator.toLowerCase().includes(q);
        const matchCountry = node.countryLong.toLowerCase().includes(q);
        if (!matchIp && !matchHost && !matchOp && !matchCountry) return false;
      }
      return true;
    });
  }, [nodes, countryFilter, onlyResidential, searchKeyword]);

  const activeNodeIds = new Set(tunnels.map((t) => t.id));

  return (
    <div className="space-y-6">
      {/* 顶部标题栏 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onBackToConfig}
            className="h-9 border-white/10 hover:bg-white/5 text-white/80 shrink-0"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            返回配置管理
          </Button>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Globe2 className="h-6 w-6 text-indigo-400" />
              全球住宅节点池
            </h1>
            <p className="text-xs text-white/50 mt-0.5">
              全球志愿者家庭/教育网宽带 IP · 仅监听本地回环 127.0.0.1 · 公网 0 端口暴露
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchNodes(true)}
            disabled={isLoadingNodes}
            className="h-9 border-white/10 hover:bg-white/5 text-white/80"
          >
            <RefreshCw className={cn("h-4 w-4 mr-1.5", isLoadingNodes && "animate-spin")} />
            拉取最新节点
          </Button>
        </div>
      </div>

      {/* 统计概览 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-white/10 bg-black/40 backdrop-blur-md">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-white/40">活跃住宅隧道</p>
              <p className="text-2xl font-bold text-white mt-1">
                {tunnels.length} <span className="text-xs font-normal text-white/40">/ 8 最大并发</span>
              </p>
            </div>
            <Activity className={cn("h-8 w-8", tunnels.length > 0 ? "text-emerald-400" : "text-white/20")} />
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-black/40 backdrop-blur-md">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-white/40">已探活住宅节点</p>
              <p className="text-2xl font-bold text-white mt-1">
                {nodes.filter((n) => n.reachable).length} <span className="text-xs font-normal text-white/40">/ {nodes.length} 总候选</span>
              </p>
            </div>
            <Wifi className="h-8 w-8 text-indigo-400" />
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-black/40 backdrop-blur-md">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-white/40">覆盖国家 / 地区</p>
              <p className="text-2xl font-bold text-white mt-1">{countries.length} 个</p>
            </div>
            <Globe2 className="h-8 w-8 text-amber-400" />
          </CardContent>
        </Card>
      </div>

      {/* 筛选与搜索控制卡片 */}
      <Card className="border-white/10 bg-black/40 backdrop-blur-md">
        <CardContent className="p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            {/* 国家筛选 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/50 whitespace-nowrap">国家/地区:</span>
              <select
                aria-label="选择国家地区"
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
                className="h-8 rounded-lg bg-white/5 border border-white/10 px-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 appearance-none cursor-pointer"
              >
                <option value="all" className="bg-neutral-900 text-white">全部国家 ({nodes.length})</option>
                {countries.map(([c, count]) => {
                  const reg = regionFromGeo(c, c);
                  return (
                    <option key={c} value={c} className="bg-neutral-900 text-white">
                      {reg.emoji} {reg.label} ({count})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* 搜索框 */}
            <div className="relative flex-1 min-w-[180px] max-w-sm">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-white/30" />
              <Input
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索 IP、主机名或运营商..."
                className="h-8 pl-8 text-xs bg-white/5 border-white/10"
              />
            </div>

            {/* 纯住宅宽带开关 */}
            <label className="flex items-center gap-1.5 text-xs text-white/70 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyResidential}
                onChange={(e) => setOnlyResidential(e.target.checked)}
                className="rounded bg-white/10 border-white/20 text-indigo-600 focus:ring-0"
              />
              仅显示住宅/家庭宽带
            </label>
          </div>

          <div className="text-xs text-white/40">
            找到 <span className="font-mono text-white/80">{filteredNodes.length}</span> 个匹配节点
          </div>
        </CardContent>
      </Card>

      {/* 节点列表主体 */}
      {isLoadingNodes && nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-white/40">
          <Loader2 className="h-8 w-8 animate-spin mb-3 text-indigo-400" />
          <p className="text-sm">正在拉取并探测 VPNGate 全球住宅节点...</p>
        </div>
      ) : filteredNodes.length === 0 ? (
        <Card className="border-white/10 bg-black/30 backdrop-blur-md text-center py-16 px-4">
          <CardContent className="flex flex-col items-center max-w-sm mx-auto">
            <Globe2 className="h-12 w-12 text-white/20 mb-4" />
            <h3 className="text-base font-semibold text-white/90 mb-1">未找到匹配节点</h3>
            <p className="text-xs text-white/40 mb-4">您可以清除过滤条件或点击右上角刷新拉取最新列表。</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCountryFilter("all");
                setSearchKeyword("");
                setOnlyResidential(false);
              }}
              className="border-white/10 hover:bg-white/5"
            >
              重置筛选条件
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredNodes.map((node) => {
            const reg = regionFromGeo(node.countryShort, node.countryLong);
            const isAlive = activeNodeIds.has(node.id);
            const activeTunnel = tunnels.find((t) => t.id === node.id);
            const isOperating = operatingId === node.id;

            return (
              <Card
                key={node.id}
                className={cn(
                  "border-white/10 bg-black/40 backdrop-blur-md flex flex-col justify-between transition-all duration-200 hover:border-white/20",
                  isAlive && "border-emerald-500/40 shadow-lg shadow-emerald-500/5 bg-emerald-950/10"
                )}
              >
                <CardHeader className="pb-2 border-b border-white/5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-xl shrink-0">{reg.emoji}</span>
                      <div className="truncate">
                        <CardTitle className="text-sm font-semibold text-white/90 truncate">
                          {reg.label} · {node.ip}
                        </CardTitle>
                        <p className="text-[11px] font-mono text-white/40 truncate">{node.hostname}</p>
                      </div>
                    </div>
                    {isAlive ? (
                      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px] shrink-0">
                        ⚡ 端口 {activeTunnel?.port}
                      </Badge>
                    ) : node.reachable ? (
                      <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px] shrink-0">
                        {node.latencyMs ? `${node.latencyMs}ms` : "在线"}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-white/10 text-white/30 text-[10px] shrink-0">
                        超时
                      </Badge>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="py-3 text-xs text-white/50 space-y-1.5 flex-1">
                  <div className="flex items-center justify-between">
                    <span>IP 类型：</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] font-normal",
                        node.ipType.includes("住宅")
                          ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/10"
                          : "border-indigo-500/30 text-indigo-300 bg-indigo-500/10"
                      )}
                    >
                      {node.ipType}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>运营商：</span>
                    <span className="truncate max-w-[160px] text-white/70" title={node.operator}>
                      {node.operator || "公共家庭宽带"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>带宽/评分：</span>
                    <span className="font-mono text-white/70">
                      {node.speed ? `${(node.speed / 1000 / 1000).toFixed(1)} Mbps` : "-"} / {node.score}分
                    </span>
                  </div>
                </CardContent>

                <div className="p-3 border-t border-white/5 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-white/40">
                    {isAlive ? "本地回环运行中" : "未建立隧道"}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isAlive ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStopTunnel(node.id)}
                          disabled={isOperating}
                          className="h-7 text-xs border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                        >
                          {isOperating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Power className="h-3 w-3 mr-1" />}
                          断开
                        </Button>
                        {onSelectTunnelForConfig && activeTunnel && (
                          <Button
                            size="sm"
                            onClick={() => onSelectTunnelForConfig(activeTunnel)}
                            className="h-7 text-xs bg-indigo-600 hover:bg-indigo-500 text-white"
                          >
                            引入此节点
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartTunnel(node)}
                        disabled={isOperating || !node.reachable}
                        className="h-7 text-xs border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10"
                      >
                        {isOperating ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            启动中...
                          </>
                        ) : (
                          <>
                            <Activity className="h-3 w-3 mr-1" />
                            启动隧道
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

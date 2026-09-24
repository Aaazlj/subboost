"use client";

import * as React from "react";
import {
  Activity,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Globe2,
  Layers,
  Loader2,
  Power,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import { Badge } from "@subboost/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { withBasePath } from "@subboost/ui/lib/base-path";
import { regionFromGeo } from "@subboost/core/node-region-formatter";
import { cn } from "@subboost/ui/lib/utils";

export type ActiveTunnelItem = {
  id: string;
  hostname: string;
  ip: string;
  country: string;
  tun: string;
  port: number;
  publicIp?: string;
  egressIp?: string;
  username?: string;
  password?: string;
  tableId: number;
  alive: boolean;
  startTime: number;
};

interface ActiveTunnelsPanelProps {
  onInjectTunnelToConfig?: (tunnel: ActiveTunnelItem) => void;
  onGoToResidentialPool?: () => void;
}

function formatUptime(startTime: number): string {
  if (!startTime) return "刚刚启动";
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - startTime);
  if (diff < 60) return `${diff} 秒`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours} 小时 ${remMins} 分钟`;
}

export function ActiveTunnelsPanel({
  onInjectTunnelToConfig,
  onGoToResidentialPool,
}: ActiveTunnelsPanelProps) {
  const { toast } = useToast();
  const [tunnels, setTunnels] = React.useState<ActiveTunnelItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [operatingId, setOperatingId] = React.useState<string | null>(null);
  const [copiedPort, setCopiedPort] = React.useState<number | null>(null);

  const fetchTunnels = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(withBasePath("/api/vpngate/tunnels"), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tunnels)) {
          setTunnels(data.tunnels);
        }
      } else {
        toast({ title: "获取隧道列表失败", variant: "destructive" });
      }
    } catch {
      toast({ title: "网络连接失败", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    fetchTunnels();
    // 每 15 秒轻量轮询更新隧道状态
    const timer = setInterval(fetchTunnels, 15000);
    return () => clearInterval(timer);
  }, [fetchTunnels]);

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
      toast({ title: "隧道已安全断开", description: "OpenVPN 守护进程已退出，对应端口已释放。" });
      await fetchTunnels();
    } catch (err: unknown) {
      toast({
        title: "断开失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setOperatingId(null);
    }
  };

  // 复制直连代理 URL
  const handleCopyDirectSocks5 = async (tunnel: ActiveTunnelItem) => {
    const host = tunnel.publicIp || "47.89.253.12";
    const authPart =
      tunnel.username && tunnel.password ? `${tunnel.username}:${tunnel.password}@` : "";
    const url = `socks5://${authPart}${host}:${tunnel.port}`;

    try {
      await navigator.clipboard.writeText(url);
      setCopiedPort(tunnel.port);
      toast({
        title: "代理地址已复制",
        description: `${url} (可直接在支持 SOCKS5 的客户端配置)`,
      });
      setTimeout(() => setCopiedPort(null), 2500);
    } catch {
      toast({ title: "复制失败", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* 顶部标题栏 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Zap className="h-6 w-6 text-amber-400" />
            已激活住宅隧道管理
          </h1>
          <p className="text-xs text-white/50 mt-1">
            独立监控与管理正在 VPS 宿主机后台常驻运行的 OpenVPN 隧道及 SOCKS5 出口服务
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchTunnels}
            disabled={isLoading}
            className="h-9 border-white/10 hover:bg-white/5 text-white/80"
          >
            <RefreshCw className={cn("h-4 w-4 mr-1.5", isLoading && "animate-spin")} />
            刷新状态
          </Button>
          {onGoToResidentialPool && (
            <Button
              size="sm"
              onClick={onGoToResidentialPool}
              className="h-9 bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20"
            >
              <Globe2 className="h-4 w-4 mr-1.5 text-emerald-300" />
              前往节点池拉取并启动新隧道
            </Button>
          )}
        </div>
      </div>

      {/* 隧道统计信息卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-white/10 bg-black/40 backdrop-blur-md">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-white/40">当前运行中隧道</p>
              <p className="text-2xl font-bold text-white mt-1">
                {tunnels.length} <span className="text-xs font-normal text-white/40">/ 8 最大并发槽位</span>
              </p>
            </div>
            <Activity className={cn("h-8 w-8", tunnels.length > 0 ? "text-emerald-400" : "text-white/20")} />
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-black/40 backdrop-blur-md">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-white/40">公网服务端口映射</p>
              <p className="text-sm font-semibold text-emerald-400 mt-1 font-mono">
                10001 ~ 10008
              </p>
              <p className="text-[11px] text-white/40 mt-0.5">支持公网直连与链式中转</p>
            </div>
            <Server className="h-8 w-8 text-indigo-400" />
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-black/40 backdrop-blur-md">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-white/40">安全防护策略</p>
              <p className="text-sm font-semibold text-amber-400 mt-1">RFC 1929 密码鉴权</p>
              <p className="text-[11px] text-white/40 mt-0.5">SO_BINDTODEVICE 独立路由表隔离</p>
            </div>
            <ShieldCheck className="h-8 w-8 text-amber-400" />
          </CardContent>
        </Card>
      </div>

      {/* 隧道列表 */}
      {isLoading && tunnels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-white/40 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
          <p className="text-sm">正在加载活跃隧道数据...</p>
        </div>
      ) : tunnels.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-white/10 rounded-2xl bg-white/[0.02] space-y-4">
          <div className="h-14 w-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-white/40">
            <Zap className="h-7 w-7 text-white/30" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">暂无正在运行的住宅隧道</h3>
            <p className="text-xs text-white/50 max-w-md mx-auto mt-1.5 leading-relaxed">
              您当前尚未启动任何 OpenVPN 住宅出口隧道。前往「全球住宅节点池」浏览全球家庭宽带节点，一键启动即可在此进行统一管理和注入。
            </p>
          </div>
          {onGoToResidentialPool && (
            <Button
              onClick={onGoToResidentialPool}
              className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20"
            >
              <Globe2 className="h-4 w-4 mr-1.5 text-emerald-300" />
              前往全球住宅节点池
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tunnels.map((tunnel) => {
            const reg = regionFromGeo(tunnel.country, tunnel.country);
            const isOperating = operatingId === tunnel.id;
            const isCopied = copiedPort === tunnel.port;
            const publicHost = tunnel.publicIp || "47.89.253.12";

            return (
              <Card
                key={tunnel.id}
                className="border-white/10 bg-neutral-900/60 backdrop-blur-md hover:border-emerald-500/40 transition-all duration-300"
              >
                <CardHeader className="p-4 pb-2 border-b border-white/5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl" title={reg.label}>
                        {reg.emoji}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white text-sm">
                            {reg.label} 住宅出口
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono"
                          >
                            {tunnel.tun}
                          </Badge>
                        </div>
                        <p className="text-xs text-white/40 font-mono mt-0.5">
                          公网出口 IP: {tunnel.egressIp || "未检测"}
                        </p>
                      </div>
                    </div>

                    <Badge
                      variant="outline"
                      className="text-[11px] bg-emerald-500/10 text-emerald-300 border-emerald-500/30 flex items-center gap-1 shrink-0"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      运行中
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs bg-black/30 p-2.5 rounded-lg border border-white/5 font-mono">
                    <div>
                      <span className="text-white/40 block text-[10px]">服务端口 (PORT)</span>
                      <span className="text-emerald-400 font-bold">:{tunnel.port}</span>
                    </div>
                    <div>
                      <span className="text-white/40 block text-[10px]">公网访问地址</span>
                      <span className="text-white/80 truncate block">{publicHost}</span>
                    </div>
                    <div>
                      <span className="text-white/40 block text-[10px]">运行时长</span>
                      <span className="text-white/70 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-white/30" />
                        {formatUptime(tunnel.startTime)}
                      </span>
                    </div>
                    <div>
                      <span className="text-white/40 block text-[10px]">SOCKS5 认证</span>
                      <span className="text-amber-300 truncate block">
                        {tunnel.username || "subboost"} / {tunnel.password ? "••••••" : "已保护"}
                      </span>
                    </div>
                  </div>

                  {/* 操作按钮组 */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyDirectSocks5(tunnel)}
                        className="h-8 text-xs border-white/10 hover:bg-white/5 text-white/80"
                        title="复制 socks5:// 协议直连地址"
                      >
                        {isCopied ? (
                          <>
                            <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                            已复制直连
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5 mr-1" />
                            复制直连
                          </>
                        )}
                      </Button>

                      {onInjectTunnelToConfig && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onInjectTunnelToConfig(tunnel)}
                          className="h-8 text-xs border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300"
                        >
                          <Layers className="h-3.5 w-3.5 mr-1" />
                          注入到配置
                        </Button>
                      )}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStopTunnel(tunnel.id)}
                      disabled={isOperating}
                      className="h-8 text-xs border-rose-500/20 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                    >
                      {isOperating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <Power className="h-3.5 w-3.5 mr-1" />
                          断开释放
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import { Check, Info, Loader2, Save, Server, Shield, Sparkles } from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import { Input } from "@subboost/ui/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@subboost/ui/components/ui/card";
import { useToast } from "@subboost/ui/components/ui/toaster";
import { withBasePath } from "@subboost/ui/lib/base-path";

export function SettingsPanel() {
  const { toast } = useToast();
  const [publicIp, setPublicIp] = React.useState("47.89.253.12");
  const [socksUser, setSocksUser] = React.useState("subboost");
  const [socksPass, setSocksPass] = React.useState("subboost888");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  const fetchSettings = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(withBasePath("/api/settings"), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          if (data.settings.publicIp) setPublicIp(data.settings.publicIp);
          if (data.settings.socksUser) setSocksUser(data.settings.socksUser);
          if (data.settings.socksPass) setSocksPass(data.settings.socksPass);
        }
      }
    } catch {
      // 忽略初次静默失败
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicIp.trim()) {
      toast({ title: "公网 IP / 域名不能为空", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(withBasePath("/api/settings"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicIp: publicIp.trim(),
          socksUser: socksUser.trim(),
          socksPass: socksPass.trim(),
        }),
      });
      if (!res.ok) {
        throw new Error("保存系统配置失败");
      }
      toast({
        title: "设置已保存",
        description: "后续启动的住宅节点隧道将使用最新的公网地址与认证凭据。",
      });
    } catch (err: unknown) {
      toast({
        title: "保存失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* 顶部标题栏 */}
      <div className="border-b border-white/10 pb-5">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Server className="h-6 w-6 text-indigo-400" />
          系统与代理网络设置
        </h1>
        <p className="text-xs text-white/50 mt-1">
          配置 VPS 服务器公网 IP、住宅代理开放端口鉴权与主订阅同步策略
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* 服务器与公网地址设置 */}
        <Card className="border-white/10 bg-black/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Server className="h-4 w-4 text-emerald-400" />
              服务器公网访问配置
            </CardTitle>
            <CardDescription className="text-xs text-white/50">
              用于客户端直接连接或海外机场节点（前置代理）通过公网连接本 VPS 的 SOCKS5 服务端口
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/80">
                服务器公网 IP 或直连域名 (Server Address)
              </label>
              <Input
                value={publicIp}
                onChange={(e) => setPublicIp(e.target.value)}
                placeholder="例如: 47.89.253.12 或 proxy.yourdomain.com"
                disabled={isLoading}
                className="bg-white/5 border-white/10 font-mono text-sm"
              />
              <p className="text-[11px] text-white/40">
                ⚠️ 重要：请确保该域名或 IP 未经过 Cloudflare 等 CDN 代理（需为 DNS Only 或原始 IP），以便 10001-10008 TCP 端口直通。
              </p>
            </div>
          </CardContent>
        </Card>

        {/* SOCKS5 安全认证 */}
        <Card className="border-white/10 bg-black/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-400" />
              SOCKS5 代理安全鉴权 (RFC 1929)
            </CardTitle>
            <CardDescription className="text-xs text-white/50">
              住宅隧道在 VPS 端口 10001-10008 开启公网监听，启用账号密码认证可防止端口被互联网爬虫滥用
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/80">认证用户名 (Username)</label>
                <Input
                  value={socksUser}
                  onChange={(e) => setSocksUser(e.target.value)}
                  placeholder="默认: subboost"
                  disabled={isLoading}
                  className="bg-white/5 border-white/10 font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/80">认证密码 (Password)</label>
                <Input
                  type="password"
                  value={socksPass}
                  onChange={(e) => setSocksPass(e.target.value)}
                  placeholder="默认: subboost888"
                  disabled={isLoading}
                  className="bg-white/5 border-white/10 font-mono text-sm"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 主订阅同步与存储说明 */}
        <Card className="border-white/10 bg-black/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-400" />
              主订阅与磁盘挂载状态
            </CardTitle>
            <CardDescription className="text-xs text-white/50">
              宿主机主订阅映射路径与自动同步机制
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-white/70">
            <div className="p-3 rounded-lg bg-white/5 border border-white/5 font-mono text-[11px] space-y-1">
              <p>• 宿主机输出目录：<span className="text-emerald-400">/root/subboost/data</span></p>
              <p>• 订阅配置文件名：<span className="text-emerald-400">clash-config.yaml</span></p>
              <p>• 公网主订阅直链：<span className="text-indigo-400">https://clash.leozai.com</span></p>
            </div>
            <p className="text-[11px] text-white/40">
              ⚡ 实时同步机制已开启：凡是标记为「已应用（Primary）」的配置，无论在界面上进行添加节点、重命名或引入住宅节点，只要点击「保存配置」，系统将自动实时重新生成并覆盖该文件，客户端刷新即刻获得最新节点。
            </p>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isSaving || isLoading}
            className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 px-6"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                正在保存...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                保存系统设置
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

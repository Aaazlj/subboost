"use client";

import * as React from "react";
import Image from "next/image";
import { Lock, KeyRound, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import { Input } from "@subboost/ui/components/ui/input";
import { toast } from "@subboost/ui/components/ui/toaster";
import { withBasePath } from "@subboost/ui/lib/base-path";

type AuthStatus = {
  loading: boolean;
  setupRequired: boolean;
  authenticated: boolean;
};

export function PanelAuthGuard({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthStatus>({
    loading: true,
    setupRequired: false,
    authenticated: false,
  });

  // 初始化密码表单
  const [initPassword, setInitPassword] = React.useState("");
  const [initConfirm, setInitConfirm] = React.useState("");
  const [initSubmitting, setInitSubmitting] = React.useState(false);

  // 解锁密码表单
  const [unlockPassword, setUnlockPassword] = React.useState("");
  const [unlockSubmitting, setUnlockSubmitting] = React.useState(false);

  const checkStatus = React.useCallback(async () => {
    try {
      const res = await fetch(withBasePath("/api/auth/me"), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setStatus({
          loading: false,
          setupRequired: Boolean(data.setupRequired),
          authenticated: Boolean(data.authenticated),
        });
      } else {
        setStatus((prev) => ({ ...prev, loading: false }));
      }
    } catch {
      setStatus((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  React.useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const handleInit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!initPassword || initPassword.length < 6) {
      toast({ title: "密码至少需要 6 个字符", variant: "destructive" });
      return;
    }
    if (initPassword !== initConfirm) {
      toast({ title: "两次输入的密码不一致", variant: "destructive" });
      return;
    }

    setInitSubmitting(true);
    try {
      const res = await fetch(withBasePath("/api/setup/admin"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: initPassword,
          passwordConfirm: initConfirm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error || "初始化失败", variant: "destructive" });
        return;
      }
      toast({ title: "面板密码初始化成功" });
      setStatus({ loading: false, setupRequired: false, authenticated: true });
    } catch {
      toast({ title: "网络异常，请重试", variant: "destructive" });
    } finally {
      setInitSubmitting(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockPassword) return;

    setUnlockSubmitting(true);
    try {
      const res = await fetch(withBasePath("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: unlockPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error || "密码错误", variant: "destructive" });
        return;
      }
      toast({ title: "解锁成功" });
      setStatus({ loading: false, setupRequired: false, authenticated: true });
    } catch {
      toast({ title: "网络异常，请重试", variant: "destructive" });
    } finally {
      setUnlockSubmitting(false);
    }
  };

  if (status.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black/80">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  // 场景 1：系统未初始化，引导设置面板密码
  if (status.setupRequired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-radial p-4">
        <div className="w-full max-w-md bg-dark-50/90 border border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-xl shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mb-2">
              <KeyRound className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">初始化面板密码</h1>
            <p className="text-sm text-white/50">首次部署使用，请为 SubBoost 设置管理访问密码</p>
          </div>

          <form onSubmit={handleInit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/70">新面板密码</label>
              <Input
                type="password"
                placeholder="至少 6 位密码"
                value={initPassword}
                onChange={(e) => setInitPassword(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/70">确认新密码</label>
              <Input
                type="password"
                placeholder="再次输入密码"
                value={initConfirm}
                onChange={(e) => setInitConfirm(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full h-11 text-sm font-medium gap-2" disabled={initSubmitting}>
              {initSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  保存并进入面板
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // 场景 2：已初始化但未解锁
  if (!status.authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-radial p-4">
        <div className="w-full max-w-md bg-dark-50/90 border border-white/10 rounded-2xl p-6 md:p-8 backdrop-blur-xl shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3 rounded-2xl bg-white/5 border border-white/10 text-indigo-400 mb-2">
              <Lock className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">SubBoost 面板已锁定</h1>
            <p className="text-sm text-white/50">请输入面板密码解锁访问</p>
          </div>

          <form onSubmit={handleUnlock} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/70">面板密码</label>
              <Input
                type="password"
                placeholder="请输入密码"
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                required
                autoFocus
              />
            </div>

            <Button type="submit" className="w-full h-11 text-sm font-medium gap-2" disabled={unlockSubmitting}>
              {unlockSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  解锁访问
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // 场景 3：已解锁
  return <>{children}</>;
}

import { type FormEvent, useState } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";

interface LocationState {
  from?: { pathname?: string };
}

export default function LoginPage() {
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const from = state?.from?.pathname ?? "/";

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-sidebar">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 rounded-md bg-brand flex items-center justify-center">
            <span className="text-xs font-black text-white">153</span>
          </div>
          <p className="text-sm text-sidebar-foreground/50 animate-pulse">로딩 중…</p>
        </div>
      </main>
    );
  }

  if (user) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setSubmitting(false);
    if (signInError) {
      setError("이메일 또는 비밀번호가 올바르지 않습니다.");
      return;
    }
    navigate(from, { replace: true });
  }

  return (
    <main className="min-h-screen flex">
      {/* 왼쪽: 브랜드 패널 */}
      <div className="hidden lg:flex lg:w-[420px] xl:w-[480px] flex-col bg-sidebar relative overflow-hidden">
        {/* 배경 패턴 */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: "32px 32px",
          }}
        />
        {/* 레드 그라데이션 원 */}
        <div className="absolute -bottom-32 -left-32 size-96 rounded-full bg-brand/20 blur-3xl" />
        <div className="absolute -top-32 -right-32 size-64 rounded-full bg-brand/10 blur-3xl" />

        <div className="relative flex flex-1 flex-col justify-between p-10">
          {/* 로고 */}
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-brand shadow-lg shadow-brand/30">
              <span className="text-sm font-black text-white leading-none">153</span>
            </div>
            <div>
              <p className="text-sm font-black tracking-widest text-white uppercase">Boxing OS</p>
              <p className="text-xs text-sidebar-foreground/40">Franchise Management</p>
            </div>
          </div>

          {/* 메인 카피 */}
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1">
              <div className="size-1.5 rounded-full bg-brand animate-pulse" />
              <span className="text-xs font-medium text-brand">전국 프랜차이즈 운영 시스템</span>
            </div>
            <h1 className="text-4xl font-black text-white leading-tight">
              153 복싱짐<br />
              <span className="text-brand">CRM</span>
            </h1>
            <p className="text-sm text-sidebar-foreground/50 leading-relaxed max-w-xs">
              회원권 관리부터 출입 통제까지.<br />
              프랜차이즈 운영의 모든 것을 하나로.
            </p>
          </div>

          {/* 하단 통계 */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "회원 관리", value: "통합" },
              { label: "출입 통제", value: "자동" },
              { label: "전국 지점", value: "확장" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-sidebar-border bg-sidebar-muted/50 p-3 text-center"
              >
                <p className="text-lg font-black text-white">{stat.value}</p>
                <p className="text-[10px] text-sidebar-foreground/40">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 오른쪽: 로그인 폼 */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm animate-fade-in">
          {/* 모바일 로고 */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex size-8 items-center justify-center rounded-lg bg-brand">
              <span className="text-xs font-black text-white">153</span>
            </div>
            <span className="text-sm font-black tracking-wider uppercase">Boxing OS</span>
          </div>

          {/* 헤더 */}
          <div className="mb-8">
            <h2 className="text-2xl font-black text-foreground">로그인</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              관리자 계정으로 로그인하세요
            </p>
          </div>

          {/* 폼 */}
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            {/* 이메일 */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium">
                이메일
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  placeholder="admin@153boxing.com"
                  className="pl-9"
                />
              </div>
            </div>

            {/* 비밀번호 */}
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium">
                비밀번호
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pl-9 pr-10"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* 에러 */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5">
                <div className="size-1.5 shrink-0 rounded-full bg-danger" />
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}

            {/* 로그인 버튼 */}
            <Button
              type="submit"
              disabled={submitting}
              className="w-full font-semibold gap-2 mt-2"
            >
              {submitting ? (
                <>
                  <span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  로그인 중…
                </>
              ) : (
                "로그인"
              )}
            </Button>
          </form>

          {/* 하단 안내 */}
          <p className="mt-6 text-center text-xs text-muted-foreground">
            계정이 없으신가요?{" "}
            <span className="text-foreground font-medium">본사 관리자에게 문의하세요</span>
          </p>
        </div>
      </div>
    </main>
  );
}

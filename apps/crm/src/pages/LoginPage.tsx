import { type FormEvent, useState } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

interface LocationState {
  from?: { pathname?: string };
}

export default function LoginPage() {
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const from = state?.from?.pathname ?? "/";

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-sm opacity-70">
        로딩 중…
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
      setError(signInError.message);
      return;
    }
    navigate(from, { replace: true });
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">153 BOXING OS</h1>
          <p className="mt-1 text-sm opacity-70">CRM 로그인</p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">이메일</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">비밀번호</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "로그인 중…" : "로그인"}
          </Button>
        </form>
        <p className="text-xs opacity-60">
          계정 발급은 본사 관리자에게 요청하세요. (Supabase Auth 사용자 + profiles 매핑 필요)
        </p>
      </Card>
    </main>
  );
}

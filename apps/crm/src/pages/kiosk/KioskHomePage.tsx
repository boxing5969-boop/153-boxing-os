import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { CheckCircle2, XCircle, Search, RotateCcw, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getKioskSummary,
  lookupKioskMembers,
  maskName,
  maskPhone,
  type KioskCandidate,
  type KioskSummary,
} from "@/services/kiosk";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";

const AUTO_RESET_SECONDS = 30;

type ViewState =
  | { kind: "input" }
  | { kind: "loading" }
  | { kind: "multiple"; candidates: KioskCandidate[] }
  | { kind: "summary"; summary: KioskSummary }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

export default function KioskHomePage() {
  const { profile, authLoading } = useAuth();
  const [phoneSuffix, setPhoneSuffix] = useState("");
  const [view, setView] = useState<ViewState>({ kind: "input" });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (view.kind === "summary" || view.kind === "not_found") {
      setSecondsLeft(AUTO_RESET_SECONDS);
      const id = setInterval(() => {
        setSecondsLeft((s) => {
          if (s === null || s <= 1) {
            clearInterval(id);
            reset();
            return null;
          }
          return s - 1;
        });
      }, 1000);
      return () => clearInterval(id);
    }
    setSecondsLeft(null);
    return;
  }, [view.kind]);

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        로딩 중…
      </main>
    );
  }
  if (!profile) {
    return <Navigate to="/login" replace />;
  }

  function reset() {
    setPhoneSuffix("");
    setView({ kind: "input" });
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  async function performLookup(suffix: string) {
    setView({ kind: "loading" });
    try {
      const candidates = await lookupKioskMembers(suffix, 5);
      if (candidates.length === 0) {
        setView({ kind: "not_found" });
      } else if (candidates.length === 1 && candidates[0]) {
        const summary = await getKioskSummary(candidates[0].id);
        setView({ kind: "summary", summary });
      } else {
        setView({ kind: "multiple", candidates });
      }
    } catch (err) {
      setView({
        kind: "error",
        message: err instanceof Error ? err.message : "조회 실패",
      });
    }
  }

  async function handleSelectCandidate(id: string) {
    setView({ kind: "loading" });
    try {
      const summary = await getKioskSummary(id);
      setView({ kind: "summary", summary });
    } catch (err) {
      setView({
        kind: "error",
        message: err instanceof Error ? err.message : "조회 실패",
      });
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = phoneSuffix.trim();
    if (trimmed.length < 4) {
      setView({ kind: "error", message: "뒷자리 4자리 이상 입력해주세요" });
      return;
    }
    void performLookup(trimmed);
  }

  return (
    <main className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <h1 className="text-xl font-bold">153 BOXING — 회원 정보</h1>
          <p className="text-xs text-muted-foreground">
            {profile.name} ({profile.role}) · 키오스크 모드
          </p>
        </div>
        <Link to="/" className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline">
          <ArrowLeft className="size-3" />
          CRM 으로
        </Link>
      </header>

      <section className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">
          {view.kind === "input" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block text-center text-base text-muted-foreground" htmlFor="kphone">
                휴대폰 뒷자리 4자리를 입력하세요
              </label>
              <Input
                id="kphone"
                ref={inputRef}
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                value={phoneSuffix}
                onChange={(e) => setPhoneSuffix(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="1234"
                className="h-16 rounded-2xl text-center font-mono text-3xl tracking-widest"
                autoFocus
                maxLength={11}
              />
              <Button type="submit" size="lg" className="h-14 w-full rounded-2xl text-lg">
                <Search className="size-5" />
                조회
              </Button>
            </form>
          )}

          {view.kind === "loading" && (
            <div className="py-12 text-center text-lg text-muted-foreground">조회 중…</div>
          )}

          {view.kind === "multiple" && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold">동일 뒷자리 회원이 여러 명입니다</h2>
              <p className="text-sm text-muted-foreground">본인의 정보를 선택하세요</p>
              <ul className="space-y-2">
                {view.candidates.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full rounded-2xl border border-border bg-card p-5 text-left shadow-card transition-colors hover:bg-muted/40"
                      onClick={() => handleSelectCandidate(c.id)}
                    >
                      <div className="font-medium">{maskName(c.name)}</div>
                      <div className="mt-1 text-xs text-muted-foreground tabular">{maskPhone(c.phone)}</div>
                    </button>
                  </li>
                ))}
              </ul>
              <Button variant="outline" onClick={reset} className="h-11 w-full rounded-full">
                <RotateCcw className="size-4" />
                다시 조회
              </Button>
            </div>
          )}

          {view.kind === "summary" && (
            <SummaryView summary={view.summary} secondsLeft={secondsLeft} onReset={reset} />
          )}

          {view.kind === "not_found" && (
            <div className="space-y-4 text-center">
              <div className="inline-block rounded-2xl bg-warning/10 p-6 shadow-card">
                <Search className="size-10 text-warning" />
              </div>
              <p className="text-lg">해당 뒷자리 회원이 없습니다</p>
              <p className="text-sm text-muted-foreground">
                정확한 4자리 또는 전체 번호로 다시 조회해주세요. 신규 등록은 카운터에 문의.
              </p>
              {secondsLeft !== null && (
                <p className="text-xs text-muted-foreground">{secondsLeft}초 후 자동 초기화</p>
              )}
              <Button onClick={reset} size="lg" className="w-full">
                <RotateCcw className="size-4" />
                다시 조회
              </Button>
            </div>
          )}

          {view.kind === "error" && (
            <div className="space-y-3 text-center">
              <p className="rounded-md bg-red-50 px-3 py-3 text-sm text-red-700">
                {view.message}
              </p>
              <Button onClick={reset} size="lg" className="w-full">
                <RotateCcw className="size-4" />
                다시 조회
              </Button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function SummaryView({
  summary,
  secondsLeft,
  onReset,
}: {
  summary: KioskSummary;
  secondsLeft: number | null;
  onReset: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="text-3xl font-bold mb-2">{summary.name}</div>
        {summary.can_enter ? (
          <div className="inline-flex items-center gap-2 rounded-full bg-green-100 px-4 py-2 text-green-800">
            <CheckCircle2 className="size-5" />
            <span className="font-semibold">출입 가능</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-full bg-red-100 px-4 py-2 text-red-700">
            <XCircle className="size-5" />
            <span className="font-semibold">
              출입 불가 — {summary.cannot_enter_reason}
            </span>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-foreground/10 p-4 space-y-3 text-sm">
        {summary.plan_name && (
          <Row label="이용권" value={summary.plan_name} />
        )}
        {summary.days_remaining !== null && (
          <Row
            label="남은 기간"
            value={
              <span
                className={cn(
                  summary.days_remaining <= 3
                    ? "text-red-600 font-bold"
                    : summary.days_remaining <= 7
                      ? "text-yellow-600 font-bold"
                      : ""
                )}
              >
                {summary.days_remaining}일
              </span>
            }
          />
        )}
        {summary.trial_uses_remaining !== null && (
          <Row
            label="체험 잔여 횟수"
            value={`${summary.trial_uses_remaining}회`}
          />
        )}
        {summary.last_visit_at && (
          <Row
            label="최근 방문"
            value={
              <span className="text-muted-foreground">
                {formatDateTime(summary.last_visit_at)}
                {summary.last_visit_result === "denied" && (
                  <span className="ml-2 text-danger">(거절)</span>
                )}
              </span>
            }
          />
        )}
      </div>

      {secondsLeft !== null && (
        <p className="text-center text-xs text-muted-foreground tabular">
          {secondsLeft}초 후 자동 초기화
        </p>
      )}

      <Button onClick={onReset} size="lg" className="h-14 w-full rounded-2xl text-lg" variant="outline">
        <RotateCcw className="size-4" />
        다시 조회
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

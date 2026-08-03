import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, RotateCcw, ChevronRight, LogIn, LogOut, ScanFace, Smartphone } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ACCESS_RESULT_VALUES,
  AccessResultBadge,
  CredentialBadge,
  CREDENTIAL_TYPE_VALUES,
  accessResultLabel,
  credentialLabel,
} from "@/components/access/AccessResultBadge";
import { listAccessLogs } from "@/services/accessLogs";
import { getAutoStats } from "@/services/reportAutoStats";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/format";
import { DENIED_REASON_LABELS, type AccessResult, type CredentialType, type DeniedReason } from "@153/shared";
import { cn } from "@/lib/cn";

// 손실방지 리포트에서 딥링크로 넘어올 때 표시할 핵심 거절 사유
const LOSS_PREVENTION_REASONS: DeniedReason[] = [
  "expired_membership",
  "unpaid",
  "trial_expired",
  "trial_max_used",
  "no_valid_grant",
  "unknown_user",
  "suspended",
  "consent_revoked",
];

const PAGE_SIZE = 20;

// KST 자정 앵커 (boxing 규칙 6 — UTC 파싱 금지)
function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const ROW_TONES: Record<string, string> = {
  success: "border-l-2 border-l-success",
  denied:  "border-l-2 border-l-danger",
  error:   "border-l-2 border-l-warning",
};

function SkeletonRow() {
  return (
    <tr className="border-b border-border">
      {[140, 80, 90, 100, 100, 120].map((w, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className="h-4 rounded-md bg-muted animate-pulse" style={{ width: w }} />
        </td>
      ))}
      <td className="px-5 py-3.5" />
    </tr>
  );
}

export default function AccessLogsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // 손실방지 리포트 딥링크 지원: ?denied_reason=expired_membership
  const initialDeniedReason = searchParams.get("denied_reason") ?? "";

  const [result, setResult] = useState<"" | AccessResult>("");
  const [credential, setCredential] = useState<"" | CredentialType>("");
  const [deniedReason, setDeniedReason] = useState<string>(initialDeniedReason);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const hasFilter = !!(result || credential || deniedReason || from || to);

  const filters = useMemo(
    () => ({
      result: result || null,
      credential_type: credential || null,
      denied_reason: deniedReason || null,
      from: from ? new Date(`${from}T00:00:00`).toISOString() : null, // 검수 반영: 날짜만 파싱 시 UTC 자정 → KST 00~09시 로그 누락
      to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [result, credential, deniedReason, from, to, page]
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ["access-logs", filters],
    queryFn: () => listAccessLogs(filters),
    staleTime: 5_000,
    refetchInterval: 30_000,
  });

  // 오늘 요약 — 홈·일일 리포트와 같은 통합 집계(auto-stats) → 숫자 단일 출처, 캐시 공유
  const { profile } = useAuth();
  const { data: stats } = useQuery({
    queryKey: ["auto-stats", profile?.branch_id ?? "all"],
    queryFn: () => getAutoStats({ branchId: profile?.branch_id ?? undefined }),
    staleTime: 30_000,
  });

  // 오늘 카드 클릭 → 오늘 날짜 + 결과 필터 즉시 적용
  function filterToday(r: "" | AccessResult) {
    const t = todayKst();
    setFrom(t); setTo(t); setResult(r); setCredential(""); setDeniedReason(""); setPage(0);
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.rows ?? [];

  function resetFilters() {
    setResult(""); setCredential(""); setDeniedReason(""); setFrom(""); setTo(""); setPage(0);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="출입 현황"
        description="오늘 누가 왔는지, 왜 거절됐는지 한눈에 확인하세요"
        badge={
          total > 0 ? (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
              {total.toLocaleString()}건
            </span>
          ) : undefined
        }
      />

      {/* 오늘 요약 — 큰 카드. 누르면 바로 그 목록으로 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => filterToday("success")}
          className="rounded-2xl border border-border bg-card p-5 text-left shadow-card transition hover:border-success/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">오늘 출입</p>
            <span className="flex size-9 items-center justify-center rounded-xl bg-success/10 text-success"><LogIn className="size-4" /></span>
          </div>
          <p className="mt-2 text-3xl font-black tabular text-success">{stats?.accessSuccess ?? "…"}</p>
          <p className="mt-1 text-xs text-muted-foreground">누르면 오늘 출입만 보기</p>
        </button>
        <button
          type="button"
          onClick={() => filterToday("denied")}
          className="rounded-2xl border border-border bg-card p-5 text-left shadow-card transition hover:border-danger/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">오늘 거절</p>
            <span className="flex size-9 items-center justify-center rounded-xl bg-danger/10 text-danger"><LogOut className="size-4" /></span>
          </div>
          <p className={cn("mt-2 text-3xl font-black tabular", (stats?.accessDenied ?? 0) > 0 ? "text-danger" : "text-foreground")}>
            {stats?.accessDenied ?? "…"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">누르면 거절만 보기 · 사유 확인</p>
        </button>
        <Link
          to="/face-attendance"
          className="flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-card transition hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">얼굴 출석</p>
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><ScanFace className="size-4" /></span>
          </div>
          <p className="mt-1 text-sm font-bold text-foreground">등록 현황 · 얼굴 출입 기록 →</p>
        </Link>
        <Link
          to="/devices"
          className="flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-card transition hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">장비 상태</p>
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Smartphone className="size-4" /></span>
          </div>
          <p className="mt-1 text-sm font-bold text-foreground">인식기 · 단말 연결 확인 →</p>
        </Link>
      </div>

      {/* 필터 바 */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <Select value={result} onChange={(e) => { setResult(e.target.value as AccessResult | ""); setPage(0); }} className="min-w-[120px]">
            <option value="">결과 전체</option>
            {ACCESS_RESULT_VALUES.map((r) => <option key={r} value={r}>{accessResultLabel(r)}</option>)}
          </Select>
          <Select value={credential} onChange={(e) => { setCredential(e.target.value as CredentialType | ""); setPage(0); }} className="min-w-[130px]">
            <option value="">자격 전체</option>
            {CREDENTIAL_TYPE_VALUES.map((c) => <option key={c} value={c}>{credentialLabel(c)}</option>)}
          </Select>
          <Select value={deniedReason} onChange={(e) => { setDeniedReason(e.target.value); setPage(0); }} className="min-w-[180px]">
            <option value="">거절 사유 전체</option>
            {LOSS_PREVENTION_REASONS.map((r) => (
              <option key={r} value={r}>{DENIED_REASON_LABELS[r]}</option>
            ))}
          </Select>
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="w-36" />
            <span className="text-muted-foreground text-sm">~</span>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="w-36" />
          </div>
          {hasFilter && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1.5 text-muted-foreground">
              <RotateCcw className="size-3.5" />
              초기화
            </Button>
          )}
        </div>
      </Card>

      {/* 로그 테이블 */}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              {["시각", "결과", "자격", "회원", "단말기", "거절 사유", ""].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && [...Array(8)].map((_, i) => <SkeletonRow key={i} />)}

            {isError && (
              <tr><td colSpan={7} className="px-5 py-14 text-center text-sm text-danger">데이터를 불러오지 못했습니다</td></tr>
            )}

            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-14 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <ScrollText className="size-8 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-foreground">출입 로그가 없습니다</p>
                    <p className="text-xs text-muted-foreground">
                      {hasFilter ? "필터를 변경하거나 초기화해보세요" : "출입 이벤트가 발생하면 여기에 기록됩니다"}
                    </p>
                  </div>
                </td>
              </tr>
            )}

            {rows.map((r) => (
              <tr
                key={r.id}
                className={cn(
                  "transition-colors",
                  ROW_TONES[r.result] ?? "",
                  r.member_id ? "cursor-pointer hover:bg-muted/40" : "hover:bg-muted/20"
                )}
                onClick={() => { if (r.member_id) navigate(`/members/${r.member_id}`); }}
              >
                <td className="px-5 py-3.5 text-muted-foreground tabular text-xs whitespace-nowrap">
                  {formatDateTime(r.occurred_at)}
                </td>
                <td className="px-5 py-3.5">
                  <AccessResultBadge result={r.result} />
                </td>
                <td className="px-5 py-3.5">
                  <CredentialBadge type={r.credential_type} />
                </td>
                <td className="px-5 py-3.5 font-semibold text-foreground">
                  {r.member_name ?? (r.member_id ? "—" : <span className="text-muted-foreground font-normal">익명</span>)}
                </td>
                <td className="px-5 py-3.5 text-muted-foreground text-xs">
                  {r.device_name ?? "—"}
                </td>
                <td className="px-5 py-3.5">
                  {r.denied_reason ? (
                    <span className="text-xs text-danger bg-danger/5 rounded-md px-2 py-0.5">
                      {DENIED_REASON_LABELS[r.denied_reason]}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-right">
                  {r.member_id && (
                    <ChevronRight className="size-4 text-muted-foreground/40 ml-auto" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* 페이지네이션 */}
      {total > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground tabular">총 {total.toLocaleString()}건</span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>이전</Button>
            <span className="px-3 text-sm text-muted-foreground">{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</Button>
          </div>
        </div>
      )}
    </div>
  );
}

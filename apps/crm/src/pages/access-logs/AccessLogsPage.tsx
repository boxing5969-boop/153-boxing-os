import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, RotateCcw, ChevronRight } from "lucide-react";
import PageHeader from "@/components/PageHeader";
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

const ROW_TONES: Record<string, string> = {
  success: "border-l-4 border-l-success",
  denied:  "border-l-4 border-l-danger",
  error:   "border-l-4 border-l-warning",
};

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-44 animate-pulse rounded-md bg-muted" />
        <div className="h-3 w-36 animate-pulse rounded-md bg-muted/70" />
      </div>
      <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
      <div className="h-5 w-12 animate-pulse rounded-full bg-muted" />
    </div>
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
      from: from ? new Date(from).toISOString() : null,
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

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.rows ?? [];

  function resetFilters() {
    setResult(""); setCredential(""); setDeniedReason(""); setFrom(""); setTo(""); setPage(0);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="출입 로그"
        description="모든 출입 시도 기록 — 성공·거절·오류 포함"
        badge={
          total > 0 ? (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
              {total.toLocaleString()}건
            </span>
          ) : undefined
        }
      />

      {/* 필터 바 */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={result}
            onChange={(e) => { setResult(e.target.value as AccessResult | ""); setPage(0); }}
            className="h-10 min-w-[120px] rounded-xl"
          >
            <option value="">결과 전체</option>
            {ACCESS_RESULT_VALUES.map((r) => <option key={r} value={r}>{accessResultLabel(r)}</option>)}
          </Select>
          <Select
            value={credential}
            onChange={(e) => { setCredential(e.target.value as CredentialType | ""); setPage(0); }}
            className="h-10 min-w-[130px] rounded-xl"
          >
            <option value="">자격 전체</option>
            {CREDENTIAL_TYPE_VALUES.map((c) => <option key={c} value={c}>{credentialLabel(c)}</option>)}
          </Select>
          <Select
            value={deniedReason}
            onChange={(e) => { setDeniedReason(e.target.value); setPage(0); }}
            className="h-10 min-w-[180px] rounded-xl"
          >
            <option value="">거절 사유 전체</option>
            {LOSS_PREVENTION_REASONS.map((r) => (
              <option key={r} value={r}>{DENIED_REASON_LABELS[r]}</option>
            ))}
          </Select>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1">
            <Input
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setPage(0); }}
              className="h-8 w-36 border-0 bg-transparent px-1 shadow-none focus:ring-0"
            />
            <span className="text-sm text-muted-foreground">~</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); setPage(0); }}
              className="h-8 w-36 border-0 bg-transparent px-1 shadow-none focus:ring-0"
            />
          </div>
          {hasFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="ml-auto gap-1.5 rounded-full text-muted-foreground"
            >
              <RotateCcw className="size-3.5" />
              초기화
            </Button>
          )}
        </div>
      </div>

      {/* 로그 리스트 */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {isLoading && (
          <div className="divide-y divide-border/60">
            {[...Array(8)].map((_, i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {isError && (
          <div className="px-5 py-16 text-center text-sm text-danger">데이터를 불러오지 못했습니다</div>
        )}

        {!isLoading && !isError && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
              <ScrollText className="size-6 text-muted-foreground/60" />
            </div>
            <p className="text-sm font-semibold text-foreground">출입 로그가 없습니다</p>
            <p className="text-xs text-muted-foreground">
              {hasFilter ? "필터를 변경하거나 초기화해보세요" : "출입 이벤트가 발생하면 여기에 기록됩니다"}
            </p>
          </div>
        )}

        {!isLoading && !isError && rows.length > 0 && (
          <ul className="divide-y divide-border/60">
            {rows.map((r) => (
              <li
                key={r.id}
                className={cn(
                  "flex items-center gap-3 px-5 py-4 transition-colors",
                  ROW_TONES[r.result] ?? "",
                  r.member_id ? "group cursor-pointer hover:bg-muted/40" : "hover:bg-muted/20"
                )}
                onClick={() => { if (r.member_id) navigate(`/members/${r.member_id}`); }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">
                      {r.member_name ?? (r.member_id ? "—" : <span className="font-normal text-muted-foreground">익명</span>)}
                    </span>
                    <AccessResultBadge result={r.result} />
                    <CredentialBadge type={r.credential_type} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="tabular">{formatDateTime(r.occurred_at)}</span>
                    {r.device_name && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="truncate">{r.device_name}</span>
                      </>
                    )}
                    {r.denied_reason && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
                          {DENIED_REASON_LABELS[r.denied_reason]}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {r.member_id && (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 페이지네이션 */}
      {total > 0 && (
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-3 shadow-card">
          <span className="text-sm text-muted-foreground tabular">총 {total.toLocaleString()}건</span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="rounded-full" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>이전</Button>
            <span className="px-3 text-sm font-medium text-muted-foreground tabular">{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" className="rounded-full" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</Button>
          </div>
        </div>
      )}
    </div>
  );
}

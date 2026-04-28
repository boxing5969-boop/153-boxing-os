import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, RotateCcw, ChevronRight } from "lucide-react";
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
import { formatDateTime } from "@/lib/format";
import { DENIED_REASON_LABELS, type AccessResult, type CredentialType } from "@153/shared";
import { cn } from "@/lib/cn";

const PAGE_SIZE = 20;

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
  const [result, setResult] = useState<"" | AccessResult>("");
  const [credential, setCredential] = useState<"" | CredentialType>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const hasFilter = !!(result || credential || from || to);

  const filters = useMemo(
    () => ({
      result: result || null,
      credential_type: credential || null,
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [result, credential, from, to, page]
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
    setResult(""); setCredential(""); setFrom(""); setTo(""); setPage(0);
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

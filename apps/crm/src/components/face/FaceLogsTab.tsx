import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { RotateCcw, ScanFace } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AccessResultBadge } from "@/components/access/AccessResultBadge";
import { formatDateTime } from "@/lib/format";
import { DENIED_REASON_LABELS, type DeniedReason } from "@153/shared";
import {
  FACE_REASON_SHORT,
  listFaceLogs,
  type FaceReasonFilter,
} from "@/services/faceAttendance";
import { cn } from "@/lib/cn";

const PAGE_SIZE = 20;

const REASON_OPTIONS: { value: FaceReasonFilter; label: string }[] = [
  { value: "", label: "사유 전체" },
  { value: "ok", label: "정상 통과" },
  { value: "expired_membership", label: "이용권 만료" },
  { value: "no_valid_grant", label: "이용권 없음" },
  { value: "unknown_user", label: "미등록(전화번호 없음)" },
  { value: "consent_revoked", label: "등록 해제됨" },
];

function reasonLabel(r: DeniedReason): string {
  return FACE_REASON_SHORT[r] ?? DENIED_REASON_LABELS[r];
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border">
      {[130, 90, 80, 70, 110].map((w, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className="h-4 rounded-md bg-muted animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

export default function FaceLogsTab({ branchId }: { branchId: string | null }) {
  const navigate = useNavigate();
  const [reason, setReason] = useState<FaceReasonFilter>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const hasFilter = !!(reason || from || to);

  // 지점 필터가 바뀌면 1페이지로
  useEffect(() => {
    setPage(0);
  }, [branchId]);

  const filters = useMemo(
    () => ({
      branch_id: branchId,
      reason,
      from: from ? new Date(`${from}T00:00:00`).toISOString() : null, // 검수 반영: 날짜만 넘기면 UTC 자정 파싱 → KST 00~09시 로그 누락
      to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [branchId, reason, from, to, page]
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ["face-logs", filters],
    queryFn: () => listFaceLogs(filters),
    staleTime: 5_000,
    refetchInterval: 30_000,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.rows ?? [];

  function resetFilters() {
    setReason("");
    setFrom("");
    setTo("");
    setPage(0);
  }

  return (
    <div className="space-y-4">
      {data?.pilot_soft && (
        <p className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">
          파일럿 모드 — 이용권 문제가 있어도 통과 처리하고 사유만 기록합니다. 실제 차단은 문
          제어 연동(FC-4)부터 시작됩니다.
        </p>
      )}

      {/* 필터 바 */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as FaceReasonFilter);
              setPage(0);
            }}
            className="min-w-[160px]"
          >
            {REASON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(0);
              }}
              className="w-36"
            />
            <span className="text-sm text-muted-foreground">~</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
              className="w-36"
            />
          </div>
          {hasFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="gap-1.5 text-muted-foreground"
            >
              <RotateCcw className="size-3.5" />
              초기화
            </Button>
          )}
          <span className="ml-auto text-sm text-muted-foreground tabular">
            총 {total.toLocaleString()}건
          </span>
        </div>
      </Card>

      {/* 로그 테이블 */}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              {["시각", "회원", "지점", "결과", "사유"].map((h) => (
                <th
                  key={h}
                  className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && [...Array(8)].map((_, i) => <SkeletonRow key={i} />)}

            {isError && (
              <tr>
                <td colSpan={5} className="px-5 py-14 text-center text-sm text-danger">
                  출입 로그를 불러오지 못했습니다
                </td>
              </tr>
            )}

            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-14 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <ScanFace className="size-8 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-foreground">얼굴 출입 기록이 없습니다</p>
                    <p className="text-xs text-muted-foreground">
                      {hasFilter
                        ? "필터를 변경하거나 초기화해보세요"
                        : "키오스크에서 얼굴 인식이 일어나면 여기에 기록됩니다"}
                    </p>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading &&
              !isError &&
              rows.map((r) => (
                <tr
                  key={r.id}
                  className={cn(
                    "transition-colors",
                    r.denied_reason ? "border-l-2 border-l-warning" : "border-l-2 border-l-success",
                    r.member_id ? "cursor-pointer hover:bg-muted/40" : "hover:bg-muted/20"
                  )}
                  onClick={() => {
                    if (r.member_id) navigate(`/members/${r.member_id}`);
                  }}
                >
                  <td className="px-5 py-3.5 text-xs text-muted-foreground tabular whitespace-nowrap">
                    {formatDateTime(r.occurred_at)}
                  </td>
                  <td className="px-5 py-3.5 font-semibold text-foreground">
                    {r.member_name ?? <span className="font-normal text-muted-foreground">—</span>}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-muted-foreground">
                    {r.branch_name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    <AccessResultBadge result={r.result} />
                  </td>
                  <td className="px-5 py-3.5">
                    {r.denied_reason ? (
                      <span className="rounded-md bg-warning/10 px-2 py-0.5 text-xs text-warning">
                        {reasonLabel(r.denied_reason)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
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
          <span className="text-sm text-muted-foreground tabular">
            {page + 1} / {totalPages} 페이지
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              이전
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

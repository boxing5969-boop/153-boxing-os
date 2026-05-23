import { useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, SlidersHorizontal, UserSearch } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  VISITOR_STATUS_VALUES,
  VisitorStatusBadge,
  visitPurposeLabel,
  visitorStatusLabel,
} from "@/components/visitors/VisitorStatusBadge";
import { NewVisitorDialog } from "@/components/visitors/NewVisitorDialog";
import { listVisitors, updateVisitorStatus } from "@/services/visitors";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime, formatPhone } from "@/lib/format";
import type { VisitorRequestStatus } from "@153/shared";

const PAGE_SIZE = 20;

export default function VisitorsListPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [status, setStatus] = useState<"" | VisitorRequestStatus>("");
  const [page, setPage] = useState(0);
  const [openNew, setOpenNew] = useState(false);

  const filters = useMemo(
    () => ({
      status: status || null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [status, page]
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["visitors", filters],
    queryFn: () => listVisitors(filters),
    staleTime: 10_000,
  });

  const mutation = useMutation({
    mutationFn: ({ id, status: s }: { id: string; status: VisitorRequestStatus }) =>
      updateVisitorStatus(
        id,
        s,
        s === "approved" ? (profile?.id ?? null) : null
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["visitors"] });
    },
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="방문자"
        description="시설견학·상담·체험·등록 신청 관리"
        action={
          <Button onClick={() => setOpenNew(true)} className="gap-2 rounded-full">
            <Plus className="size-4" />
            신청 등록
          </Button>
        }
      />

      {/* 필터 */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5">
          <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as VisitorRequestStatus | "");
              setPage(0);
            }}
            className="min-w-[150px] max-w-xs border-0 bg-transparent px-1 shadow-none focus:ring-0"
          >
            <option value="">상태 전체</option>
            {VISITOR_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {visitorStatusLabel(s)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* 방문자 리스트 */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {isLoading && (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">로딩 중…</div>
        )}
        {isError && (
          <div className="px-5 py-16 text-center text-sm text-danger">
            오류: {errorMessage(error)}
          </div>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
              <UserSearch className="size-6 text-muted-foreground/60" />
            </div>
            <p className="text-sm font-semibold text-foreground">신청 내역이 없습니다</p>
            <p className="text-xs text-muted-foreground">
              우상단 "신청 등록"으로 추가하세요
            </p>
          </div>
        )}
        {!isLoading && !isError && rows.length > 0 && (
          <ul className="divide-y divide-border/60">
            {rows.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{v.name}</span>
                    <VisitorStatusBadge status={v.status} />
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {visitPurposeLabel(v.purpose)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="tabular">{formatPhone(v.phone)}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{v.branch_name ?? "지점 미지정"}</span>
                    {v.visit_at && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="tabular">{formatDateTime(v.visit_at)}</span>
                      </>
                    )}
                  </div>
                </div>
                {v.status === "requested" && (
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-full px-3 text-xs"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ id: v.id, status: "approved" })}
                    >
                      승인
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8 rounded-full px-3 text-xs"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ id: v.id, status: "denied" })}
                    >
                      거절
                    </Button>
                  </div>
                )}
                {v.status === "approved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-full px-3 text-xs"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ id: v.id, status: "completed" })}
                  >
                    완료 처리
                  </Button>
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
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              이전
            </Button>
            <span className="px-3 text-sm font-medium text-muted-foreground tabular">
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </Button>
          </div>
        </div>
      )}

      <NewVisitorDialog open={openNew} onClose={() => setOpenNew(false)} />
    </div>
  );
}

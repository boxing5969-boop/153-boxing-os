import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
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
          <Button onClick={() => setOpenNew(true)}>
            <Plus className="size-4" />
            신청 등록
          </Button>
        }
      />

      <Card className="p-4">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as VisitorRequestStatus | "");
            setPage(0);
          }}
          className="max-w-xs"
        >
          <option value="">상태 전체</option>
          {VISITOR_STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {visitorStatusLabel(s)}
            </option>
          ))}
        </Select>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-foreground/10 text-left text-xs uppercase opacity-60">
            <tr>
              <th className="px-4 py-3">방문자</th>
              <th className="px-4 py-3">전화</th>
              <th className="px-4 py-3">목적</th>
              <th className="px-4 py-3">지점</th>
              <th className="px-4 py-3">방문 일시</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center opacity-60">
                  로딩 중…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-red-600">
                  오류: {error instanceof Error ? error.message : "알 수 없는 오류"}
                </td>
              </tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center opacity-60">
                  신청 내역이 없습니다.
                </td>
              </tr>
            )}
            {rows.map((v) => (
              <tr key={v.id} className="border-b border-foreground/5">
                <td className="px-4 py-3 font-medium">{v.name}</td>
                <td className="px-4 py-3 opacity-80">{formatPhone(v.phone)}</td>
                <td className="px-4 py-3 opacity-80">{visitPurposeLabel(v.purpose)}</td>
                <td className="px-4 py-3 opacity-80">{v.branch_name ?? "—"}</td>
                <td className="px-4 py-3 opacity-80">
                  {v.visit_at ? formatDateTime(v.visit_at) : "—"}
                </td>
                <td className="px-4 py-3">
                  <VisitorStatusBadge status={v.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  {v.status === "requested" && (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate({ id: v.id, status: "approved" })}
                      >
                        승인
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
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
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ id: v.id, status: "completed" })}
                    >
                      완료 처리
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="opacity-70">총 {total}건</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            이전
          </Button>
          <span className="px-2 opacity-70">
            {page + 1} / {totalPages}
          </span>
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

      <NewVisitorDialog open={openNew} onClose={() => setOpenNew(false)} />
    </div>
  );
}

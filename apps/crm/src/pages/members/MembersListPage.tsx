import { useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import MemberStatusBadge, {
  MEMBER_STATUS_VALUES,
  memberStatusLabel,
} from "@/components/members/MemberStatusBadge";
import { listMembers } from "@/services/members";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatPhone, formatDate } from "@/lib/format";
import type { MemberStatus } from "@153/shared";

const PAGE_SIZE = 20;

export default function MembersListPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | MemberStatus>("");
  const [page, setPage] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 300);

  const filters = useMemo(
    () => ({
      q: debouncedQuery,
      status: statusFilter || null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [debouncedQuery, statusFilter, page]
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["members", filters],
    queryFn: () => listMembers(filters),
    staleTime: 10_000,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.rows ?? [];
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <PageHeader
        title="회원"
        description="검색/필터로 회원을 찾고, 행을 클릭해 상세를 봅니다."
        action={
          <Link to="/members/new">
            <Button>
              <Plus className="size-4" />
              신규 등록
            </Button>
          </Link>
        }
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 opacity-50" />
            <Input
              type="search"
              placeholder="이름 또는 전화번호 검색"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              className="pl-9"
            />
          </div>
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as MemberStatus | "");
              setPage(0);
            }}
          >
            <option value="">상태 전체</option>
            {MEMBER_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {memberStatusLabel(s)}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-foreground/10 text-left text-xs uppercase opacity-60">
            <tr>
              <th className="px-4 py-3">이름</th>
              <th className="px-4 py-3">전화</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">가입일</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center opacity-60">
                  로딩 중…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-red-600">
                  오류: {errorMessage(error)}
                </td>
              </tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center opacity-60">
                  검색 결과가 없습니다.
                </td>
              </tr>
            )}
            {rows.map((m) => (
              <tr
                key={m.id}
                className="border-b border-foreground/5 hover:bg-foreground/5 cursor-pointer"
                onClick={() => navigate(`/members/${m.id}`)}
              >
                <td className="px-4 py-3 font-medium">{m.name}</td>
                <td className="px-4 py-3">{formatPhone(m.phone)}</td>
                <td className="px-4 py-3">
                  <MemberStatusBadge status={m.status} />
                </td>
                <td className="px-4 py-3 opacity-70">{formatDate(m.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="opacity-70">
          {total === 0 ? "0건" : `${start}-${end} / 총 ${total}건`}
        </span>
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
    </div>
  );
}

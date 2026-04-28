import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import MemberStatusBadge from "@/components/members/MemberStatusBadge";
import { listMembers } from "@/services/members";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const PAGE_SIZE = 20;

export default function LevelsListPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 300);

  const filters = useMemo(
    () => ({
      q: debouncedQuery,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [debouncedQuery, page]
  );

  const { data, isLoading } = useQuery({
    queryKey: ["members-for-levels", filters],
    queryFn: () => listMembers(filters),
    staleTime: 10_000,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="레벨" description="회원을 선택해 White/Blue/Red/Black × Lv1~10 진행을 입력합니다." />

      <Card className="p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 opacity-50" />
          <Input
            type="search"
            placeholder="회원 이름 또는 전화"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            className="pl-9"
          />
        </div>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-foreground/10 text-left text-xs uppercase opacity-60">
            <tr>
              <th className="px-4 py-3">이름</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={3} className="px-4 py-12 text-center opacity-60">
                  로딩 중…
                </td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-12 text-center opacity-60">
                  검색 결과가 없습니다.
                </td>
              </tr>
            )}
            {rows.map((m) => (
              <tr
                key={m.id}
                className="border-b border-foreground/5 hover:bg-foreground/5 cursor-pointer"
                onClick={() => navigate(`/levels/${m.id}`)}
              >
                <td className="px-4 py-3 font-medium">{m.name}</td>
                <td className="px-4 py-3">
                  <MemberStatusBadge status={m.status} />
                </td>
                <td className="px-4 py-3 text-right opacity-60">레벨 입력 →</td>
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
    </div>
  );
}

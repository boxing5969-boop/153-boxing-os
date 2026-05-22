import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronRight, Trophy, Users } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import MemberStatusBadge from "@/components/members/MemberStatusBadge";
import { listMembers } from "@/services/members";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const AVATAR_COLORS = [
  "bg-primary/20 text-primary",
  "bg-success/20 text-success",
  "bg-warning/20 text-warning",
  "bg-purple-100 text-purple-700",
  "bg-pink-100 text-pink-700",
];
function avatarColor(name: string) {
  const code = name.charCodeAt(0) + (name.charCodeAt(1) || 0);
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

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

      {/* 검색 */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="회원 이름 또는 전화"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            className="h-11 rounded-xl pl-10"
          />
        </div>
      </div>

      {/* 리스트 */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {isLoading && (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">로딩 중…</div>
        )}
        {!isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
              <Users className="size-6 text-muted-foreground/60" />
            </div>
            <p className="text-sm font-semibold text-foreground">검색 결과가 없습니다</p>
          </div>
        )}
        {!isLoading && rows.length > 0 && (
          <ul className="divide-y divide-border/60">
            {rows.map((m) => (
              <li
                key={m.id}
                className="group flex cursor-pointer items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/40"
                onClick={() => navigate(`/levels/${m.id}`)}
              >
                <div className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                  avatarColor(m.name)
                )}>
                  {m.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{m.name}</span>
                    <MemberStatusBadge status={m.status} />
                  </div>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Trophy className="size-3" />
                    레벨 입력
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
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
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Users, ChevronRight, SlidersHorizontal } from "lucide-react";
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
import { cn } from "@/lib/cn";
import type { MemberStatus } from "@153/shared";

const PAGE_SIZE = 20;

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-primary/20 text-primary",
  "bg-success/20 text-success",
  "bg-warning/20 text-warning",
  "bg-purple-100 text-purple-700",
  "bg-pink-100 text-pink-700",
  "bg-cyan-100 text-cyan-700",
];

function avatarColor(name: string) {
  const code = name.charCodeAt(0) + (name.charCodeAt(1) || 0);
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border">
      {[...Array(4)].map((_, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className={cn("h-4 rounded-md bg-muted animate-pulse", i === 0 ? "w-32" : i === 1 ? "w-28" : i === 2 ? "w-16" : "w-20")} />
        </td>
      ))}
      <td className="px-5 py-3.5" />
    </tr>
  );
}

export default function MembersListPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | MemberStatus>("");
  const [page, setPage] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 300);

  const filters = useMemo(
    () => ({ q: debouncedQuery, status: statusFilter || null, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [debouncedQuery, statusFilter, page]
  );

  const { data, isLoading, isError } = useQuery({
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
        description="회원을 검색하고 상세 정보를 확인하세요"
        badge={
          total > 0 ? (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
              {total.toLocaleString()}명
            </span>
          ) : undefined
        }
        action={
          <Link to="/members/new">
            <Button className="gap-2">
              <Plus className="size-4" />
              신규 등록
            </Button>
          </Link>
        }
      />

      {/* 검색 + 필터 */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="이름 또는 전화번호 검색"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-muted-foreground shrink-0" />
            <Select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as MemberStatus | ""); setPage(0); }}
              className="min-w-[130px]"
            >
              <option value="">상태 전체</option>
              {MEMBER_STATUS_VALUES.map((s) => (
                <option key={s} value={s}>{memberStatusLabel(s)}</option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {/* 테이블 */}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">회원</th>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">전화번호</th>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">상태</th>
              <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">가입일</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && [...Array(6)].map((_, i) => <SkeletonRow key={i} />)}

            {isError && (
              <tr>
                <td colSpan={5} className="px-5 py-14 text-center">
                  <p className="text-sm text-danger">데이터를 불러오지 못했습니다</p>
                </td>
              </tr>
            )}

            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-14 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="size-8 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-foreground">
                      {query || statusFilter ? "검색 결과가 없습니다" : "등록된 회원이 없습니다"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {query || statusFilter ? "다른 검색어나 필터를 시도해보세요" : "신규 등록 버튼으로 첫 회원을 추가하세요"}
                    </p>
                  </div>
                </td>
              </tr>
            )}

            {rows.map((m) => (
              <tr
                key={m.id}
                className="group hover:bg-muted/40 cursor-pointer transition-colors"
                onClick={() => navigate(`/members/${m.id}`)}
              >
                {/* 회원 (아바타 + 이름) */}
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      avatarColor(m.name)
                    )}>
                      {getInitials(m.name)}
                    </div>
                    <span className="font-semibold text-foreground">{m.name}</span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-muted-foreground tabular">
                  {formatPhone(m.phone)}
                </td>
                <td className="px-5 py-3.5">
                  <MemberStatusBadge status={m.status} />
                </td>
                <td className="px-5 py-3.5 text-muted-foreground tabular">
                  {formatDate(m.created_at)}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors ml-auto" />
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
            {start}–{end} / 총 {total.toLocaleString()}명
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline" size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              이전
            </Button>
            <span className="px-3 py-1.5 text-sm font-medium text-muted-foreground">
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline" size="sm"
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

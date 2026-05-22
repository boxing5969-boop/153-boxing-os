import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Users, ChevronRight, SlidersHorizontal, CreditCard, Megaphone } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import MemberStatusBadge, {
  MEMBER_STATUS_VALUES,
  memberStatusLabel,
} from "@/components/members/MemberStatusBadge";
import { NewMembershipDialog } from "@/components/memberships/NewMembershipDialog";
import MemberBroadcastDialog from "@/components/members/MemberBroadcastDialog";
import { listMembers } from "@/services/members";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatPhone, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Member, MemberStatus } from "@153/shared";

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
    <div className="flex items-center gap-3 px-5 py-4">
      <div className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-28 animate-pulse rounded-md bg-muted" />
        <div className="h-3 w-40 animate-pulse rounded-md bg-muted/70" />
      </div>
      <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
    </div>
  );
}

export default function MembersListPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | MemberStatus>("");
  const [page, setPage] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 300);

  // 이용권 바로 등록 (목록에서 클릭)
  const [quickRegisterMember, setQuickRegisterMember] = useState<Member | null>(null);
  // 공지 발송 다이얼로그
  const [broadcastOpen, setBroadcastOpen] = useState(false);

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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setBroadcastOpen(true)}
            >
              <Megaphone className="size-4" />
              공지 발송
            </Button>
            <Link to="/members/new">
              <Button className="gap-2">
                <Plus className="size-4" />
                신규 등록
              </Button>
            </Link>
          </div>
        }
      />

      {/* 검색 + 필터 */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="이름 또는 전화번호 검색"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              className="h-11 rounded-xl pl-10"
            />
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5">
            <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
            <Select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as MemberStatus | ""); setPage(0); }}
              className="min-w-[130px] border-0 bg-transparent px-1 shadow-none focus:ring-0"
            >
              <option value="">상태 전체</option>
              {MEMBER_STATUS_VALUES.map((s) => (
                <option key={s} value={s}>{memberStatusLabel(s)}</option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {/* 회원 리스트 */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {isLoading && (
          <div className="divide-y divide-border/60">
            {[...Array(6)].map((_, i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {isError && (
          <div className="px-5 py-16 text-center">
            <p className="text-sm text-danger">데이터를 불러오지 못했습니다</p>
          </div>
        )}

        {!isLoading && !isError && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
              <Users className="size-6 text-muted-foreground/60" />
            </div>
            <p className="text-sm font-semibold text-foreground">
              {query || statusFilter ? "검색 결과가 없습니다" : "등록된 회원이 없습니다"}
            </p>
            <p className="text-xs text-muted-foreground">
              {query || statusFilter ? "다른 검색어나 필터를 시도해보세요" : "신규 등록 버튼으로 첫 회원을 추가하세요"}
            </p>
          </div>
        )}

        {!isLoading && !isError && rows.length > 0 && (
          <ul className="divide-y divide-border/60">
            {rows.map((m) => (
              <li
                key={m.id}
                className="group flex cursor-pointer items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/40"
                onClick={() => navigate(`/members/${m.id}`)}
              >
                {/* 아바타 */}
                <div className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                  avatarColor(m.name)
                )}>
                  {getInitials(m.name)}
                </div>

                {/* 이름·전화·가입일 */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{m.name}</span>
                    <MemberStatusBadge status={m.status} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground tabular">
                    <span>{formatPhone(m.phone)}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>가입 {formatDate(m.created_at)}</span>
                  </div>
                </div>

                {/* 액션 */}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1 rounded-full border-primary/30 px-3 text-xs text-primary opacity-0 transition-opacity hover:bg-primary/10 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      setQuickRegisterMember(m);
                    }}
                  >
                    <CreditCard className="size-3" />
                    이용권
                  </Button>
                  <ChevronRight className="size-4 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 페이지네이션 */}
      {total > 0 && (
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-3 shadow-card">
          <span className="text-sm text-muted-foreground tabular">
            {start}–{end} <span className="text-muted-foreground/60">/ 총 {total.toLocaleString()}명</span>
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline" size="sm"
              className="rounded-full"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              이전
            </Button>
            <span className="px-3 py-1.5 text-sm font-medium text-muted-foreground tabular">
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline" size="sm"
              className="rounded-full"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              다음
            </Button>
          </div>
        </div>
      )}

      {/* 이용권 바로 등록 다이얼로그 */}
      {quickRegisterMember && (
        <NewMembershipDialog
          open={!!quickRegisterMember}
          onClose={() => setQuickRegisterMember(null)}
          member={quickRegisterMember}
        />
      )}

      {/* 공지 발송 다이얼로그 */}
      <MemberBroadcastDialog
        open={broadcastOpen}
        onClose={() => setBroadcastOpen(false)}
      />
    </div>
  );
}

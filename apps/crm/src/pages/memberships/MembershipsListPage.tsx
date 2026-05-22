import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Ticket, ChevronRight, SlidersHorizontal } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  MEMBERSHIP_STATUS_VALUES,
  MembershipStatusBadge,
  PaymentStatusBadge,
  TRIAL_STATUS_VALUES,
  TrialStatusBadge,
  membershipStatusLabel,
  trialStatusLabel,
} from "@/components/memberships/MembershipStatusBadge";
import { listMemberships } from "@/services/memberships";
import { listTrialPasses } from "@/services/trialPasses";
import { formatDate, formatDateTime } from "@/lib/format";
import type { MembershipStatus, TrialPassStatus } from "@153/shared";

const PAGE_SIZE = 20;
type Tab = "memberships" | "trials";

function TabBtn({ active, icon: Icon, label, count, onClick }: {
  active: boolean;
  icon: React.ElementType;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
      )}
    >
      <Icon className="size-4" />
      {label}
      {count != null && (
        <span className={cn(
          "rounded-full px-2 py-0.5 text-xs font-bold",
          active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-32 animate-pulse rounded-md bg-muted" />
        <div className="h-3 w-48 animate-pulse rounded-md bg-muted/70" />
      </div>
      <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
      <div className="h-5 w-12 animate-pulse rounded-full bg-muted" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-5 py-16 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export default function MembershipsListPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("memberships");
  const [page, setPage] = useState(0);
  const [memStatus, setMemStatus] = useState<"" | MembershipStatus>("");
  const [trialStatus, setTrialStatus] = useState<"" | TrialPassStatus>("");

  const memFilters = useMemo(
    () => ({ status: memStatus || null, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [memStatus, page]
  );
  const trialFilters = useMemo(
    () => ({ status: trialStatus || null, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [trialStatus, page]
  );

  const memQuery = useQuery({
    queryKey: ["memberships", memFilters],
    queryFn: () => listMemberships(memFilters),
    enabled: tab === "memberships",
    staleTime: 10_000,
  });
  const trialQuery = useQuery({
    queryKey: ["trialPasses", trialFilters],
    queryFn: () => listTrialPasses(trialFilters),
    enabled: tab === "trials",
    staleTime: 10_000,
  });

  const total = (tab === "memberships" ? memQuery.data?.total : trialQuery.data?.total) ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function switchTab(t: Tab) { setTab(t); setPage(0); }

  return (
    <div className="space-y-6">
      <PageHeader
        title="이용권"
        description="이용권·체험권을 조회합니다. 등록·정지·환불은 회원 상세에서 진행하세요."
      />

      {/* 탭 */}
      <div className="-mb-2 flex items-center gap-1 border-b border-border">
        <TabBtn
          active={tab === "memberships"} icon={CreditCard} label="이용권"
          count={tab === "memberships" ? memQuery.data?.total : undefined}
          onClick={() => switchTab("memberships")}
        />
        <TabBtn
          active={tab === "trials"} icon={Ticket} label="체험권"
          count={tab === "trials" ? trialQuery.data?.total : undefined}
          onClick={() => switchTab("trials")}
        />
      </div>

      {/* 필터 */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-1.5">
          <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
          {tab === "memberships" ? (
            <Select
              value={memStatus}
              onChange={(e) => { setMemStatus(e.target.value as MembershipStatus | ""); setPage(0); }}
              className="min-w-[150px] max-w-[180px] border-0 bg-transparent px-1 shadow-none focus:ring-0"
            >
              <option value="">상태 전체</option>
              {MEMBERSHIP_STATUS_VALUES.map((s) => <option key={s} value={s}>{membershipStatusLabel(s)}</option>)}
            </Select>
          ) : (
            <Select
              value={trialStatus}
              onChange={(e) => { setTrialStatus(e.target.value as TrialPassStatus | ""); setPage(0); }}
              className="min-w-[150px] max-w-[180px] border-0 bg-transparent px-1 shadow-none focus:ring-0"
            >
              <option value="">상태 전체</option>
              {TRIAL_STATUS_VALUES.map((s) => <option key={s} value={s}>{trialStatusLabel(s)}</option>)}
            </Select>
          )}
        </div>
      </div>

      {/* 리스트 */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {tab === "memberships" ? (
          <>
            {memQuery.isLoading && (
              <div className="divide-y divide-border/60">
                {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
              </div>
            )}
            {memQuery.isError && <EmptyState message="데이터를 불러오지 못했습니다" />}
            {!memQuery.isLoading && !memQuery.isError && (memQuery.data?.rows.length ?? 0) === 0 && (
              <EmptyState message="이용권이 없습니다" />
            )}
            {!memQuery.isLoading && !memQuery.isError && (memQuery.data?.rows.length ?? 0) > 0 && (
              <ul className="divide-y divide-border/60">
                {(memQuery.data?.rows ?? []).map((m) => (
                  <li
                    key={m.id}
                    className="group flex cursor-pointer items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/40"
                    onClick={() => navigate(`/members/${m.member_id}`)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold text-foreground">
                          {m.member_name ?? m.member_id.slice(0, 8)}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="truncate text-sm text-muted-foreground">{m.plan_name}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground tabular">
                        {formatDate(m.start_date)} ~ {formatDate(m.end_date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MembershipStatusBadge status={m.status} />
                      <PaymentStatusBadge status={m.payment_status} />
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            {trialQuery.isLoading && (
              <div className="divide-y divide-border/60">
                {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
              </div>
            )}
            {trialQuery.isError && <EmptyState message="데이터를 불러오지 못했습니다" />}
            {!trialQuery.isLoading && !trialQuery.isError && (trialQuery.data?.rows.length ?? 0) === 0 && (
              <EmptyState message="체험권이 없습니다" />
            )}
            {!trialQuery.isLoading && !trialQuery.isError && (trialQuery.data?.rows.length ?? 0) > 0 && (
              <ul className="divide-y divide-border/60">
                {(trialQuery.data?.rows ?? []).map((t) => {
                  const pct = t.max_entries === 0 ? 0 : (t.used_entries / t.max_entries) * 100;
                  return (
                    <li
                      key={t.id}
                      className="group flex cursor-pointer items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/40"
                      onClick={() => navigate(`/members/${t.member_id}`)}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="truncate font-semibold text-foreground">
                          {t.member_name ?? t.member_id.slice(0, 8)}
                        </span>
                        <p className="mt-0.5 text-xs text-muted-foreground tabular">
                          {formatDateTime(t.start_at)} ~ {formatDateTime(t.end_at)}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground tabular">
                            {t.used_entries}/{t.max_entries}회
                          </span>
                        </div>
                      </div>
                      <TrialStatusBadge status={t.status} />
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {/* 페이지네이션 */}
      {total > 0 && (
        <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-3 shadow-card">
          <span className="text-sm text-muted-foreground tabular">
            총 {total.toLocaleString()}건
          </span>
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

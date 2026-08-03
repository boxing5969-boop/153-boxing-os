import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Ticket, ChevronRight, UserPlus } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
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

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="border-b border-border">
      {[...Array(cols)].map((_, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className="h-4 rounded-md bg-muted animate-pulse" style={{ width: `${60 + (i * 20) % 40}%` }} />
        </td>
      ))}
      <td className="px-5 py-3.5" />
    </tr>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <tr>
      <td colSpan={6} className="px-5 py-14 text-center">
        <p className="text-sm text-muted-foreground">{message}</p>
      </td>
    </tr>
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
        title="이용권 · 결제"
        description="회원 이름을 누르면 연장·결제·정지를 바로 할 수 있어요"
        action={
          <Link to="/members">
            <Button className="gap-2">
              <UserPlus className="size-4" />
              회원 찾아 등록하기
            </Button>
          </Link>
        }
      />

      {/* 탭 */}
      <div className="flex items-center border-b border-border gap-1 -mb-2">
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

      {/* 필터 — 한 번 누르면 되는 큰 칩 버튼 */}
      <div className="flex flex-wrap gap-2">
        {tab === "memberships" ? (
          <>
            <button
              type="button"
              onClick={() => { setMemStatus(""); setPage(0); }}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                memStatus === "" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"
              )}
            >
              전체
            </button>
            {MEMBERSHIP_STATUS_VALUES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setMemStatus(s); setPage(0); }}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  memStatus === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"
                )}
              >
                {membershipStatusLabel(s)}
              </button>
            ))}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => { setTrialStatus(""); setPage(0); }}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                trialStatus === "" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"
              )}
            >
              전체
            </button>
            {TRIAL_STATUS_VALUES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setTrialStatus(s); setPage(0); }}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  trialStatus === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted"
                )}
              >
                {trialStatusLabel(s)}
              </button>
            ))}
          </>
        )}
      </div>

      {/* 테이블 */}
      <Card className="overflow-hidden">
        {tab === "memberships" ? (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                {["회원", "플랜", "기간", "이용권 상태", "결제 상태", ""].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {memQuery.isLoading && [...Array(5)].map((_, i) => <SkeletonRow key={i} cols={5} />)}
              {memQuery.isError && <EmptyState message="데이터를 불러오지 못했습니다" />}
              {!memQuery.isLoading && !memQuery.isError && (memQuery.data?.rows.length ?? 0) === 0 && <EmptyState message="이용권이 없습니다" />}
              {(memQuery.data?.rows ?? []).map((m) => (
                <tr key={m.id} className="group hover:bg-muted/40 cursor-pointer transition-colors" onClick={() => navigate(`/members/${m.member_id}`)}>
                  <td className="px-5 py-3.5 font-semibold text-foreground">{m.member_name ?? m.member_id.slice(0, 8)}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">{m.plan_name}</td>
                  <td className="px-5 py-3.5 text-muted-foreground tabular text-xs">
                    {formatDate(m.start_date)} ~ {formatDate(m.end_date)}
                  </td>
                  <td className="px-5 py-3.5"><MembershipStatusBadge status={m.status} /></td>
                  <td className="px-5 py-3.5"><PaymentStatusBadge status={m.payment_status} /></td>
                  <td className="px-5 py-3.5 text-right">
                    <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors ml-auto" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                {["회원", "기간", "사용 횟수", "상태", ""].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {trialQuery.isLoading && [...Array(5)].map((_, i) => <SkeletonRow key={i} cols={4} />)}
              {trialQuery.isError && <EmptyState message="데이터를 불러오지 못했습니다" />}
              {!trialQuery.isLoading && !trialQuery.isError && (trialQuery.data?.rows.length ?? 0) === 0 && <EmptyState message="체험권이 없습니다" />}
              {(trialQuery.data?.rows ?? []).map((t) => (
                <tr key={t.id} className="group hover:bg-muted/40 cursor-pointer transition-colors" onClick={() => navigate(`/members/${t.member_id}`)}>
                  <td className="px-5 py-3.5 font-semibold text-foreground">{t.member_name ?? t.member_id.slice(0, 8)}</td>
                  <td className="px-5 py-3.5 text-muted-foreground tabular text-xs">
                    {formatDateTime(t.start_at)} ~ {formatDateTime(t.end_at)}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${t.max_entries === 0 ? 0 : (t.used_entries / t.max_entries) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground tabular">{t.used_entries}/{t.max_entries}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5"><TrialStatusBadge status={t.status} /></td>
                  <td className="px-5 py-3.5 text-right">
                    <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors ml-auto" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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

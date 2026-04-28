import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
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

export default function MembershipsListPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("memberships");
  const [page, setPage] = useState(0);
  const [memStatus, setMemStatus] = useState<"" | MembershipStatus>("");
  const [trialStatus, setTrialStatus] = useState<"" | TrialPassStatus>("");

  const memFilters = useMemo(
    () => ({
      status: memStatus || null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [memStatus, page]
  );
  const trialFilters = useMemo(
    () => ({
      status: trialStatus || null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="이용권 / 체험권"
        description="목록 + 필터. 등록·정지·환불은 회원 상세에서 진행."
      />

      <div className="flex items-center gap-2 border-b border-foreground/10">
        <TabButton active={tab === "memberships"} onClick={() => { setTab("memberships"); setPage(0); }}>
          이용권
        </TabButton>
        <TabButton active={tab === "trials"} onClick={() => { setTab("trials"); setPage(0); }}>
          체험권
        </TabButton>
      </div>

      <Card className="p-4">
        {tab === "memberships" ? (
          <Select
            value={memStatus}
            onChange={(e) => {
              setMemStatus(e.target.value as MembershipStatus | "");
              setPage(0);
            }}
            className="max-w-xs"
          >
            <option value="">상태 전체</option>
            {MEMBERSHIP_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {membershipStatusLabel(s)}
              </option>
            ))}
          </Select>
        ) : (
          <Select
            value={trialStatus}
            onChange={(e) => {
              setTrialStatus(e.target.value as TrialPassStatus | "");
              setPage(0);
            }}
            className="max-w-xs"
          >
            <option value="">상태 전체</option>
            {TRIAL_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {trialStatusLabel(s)}
              </option>
            ))}
          </Select>
        )}
      </Card>

      <Card>
        {tab === "memberships" ? (
          <table className="w-full text-sm">
            <thead className="border-b border-foreground/10 text-left text-xs uppercase opacity-60">
              <tr>
                <th className="px-4 py-3">회원</th>
                <th className="px-4 py-3">플랜</th>
                <th className="px-4 py-3">기간</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">결제</th>
              </tr>
            </thead>
            <tbody>
              {memQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center opacity-60">
                    로딩 중…
                  </td>
                </tr>
              )}
              {memQuery.isError && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-red-600">
                    오류: {memQuery.error instanceof Error ? memQuery.error.message : "알 수 없는 오류"}
                  </td>
                </tr>
              )}
              {!memQuery.isLoading && !memQuery.isError && (memQuery.data?.rows.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center opacity-60">
                    이용권이 없습니다.
                  </td>
                </tr>
              )}
              {(memQuery.data?.rows ?? []).map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-foreground/5 hover:bg-foreground/5 cursor-pointer"
                  onClick={() => navigate(`/members/${m.member_id}`)}
                >
                  <td className="px-4 py-3 font-medium">{m.member_name ?? m.member_id.slice(0, 8)}</td>
                  <td className="px-4 py-3">{m.plan_name}</td>
                  <td className="px-4 py-3 opacity-80">
                    {formatDate(m.start_date)} ~ {formatDate(m.end_date)}
                  </td>
                  <td className="px-4 py-3">
                    <MembershipStatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-3">
                    <PaymentStatusBadge status={m.payment_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-foreground/10 text-left text-xs uppercase opacity-60">
              <tr>
                <th className="px-4 py-3">회원</th>
                <th className="px-4 py-3">기간</th>
                <th className="px-4 py-3">사용</th>
                <th className="px-4 py-3">상태</th>
              </tr>
            </thead>
            <tbody>
              {trialQuery.isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center opacity-60">
                    로딩 중…
                  </td>
                </tr>
              )}
              {trialQuery.isError && (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-red-600">
                    오류: {trialQuery.error instanceof Error ? trialQuery.error.message : "알 수 없는 오류"}
                  </td>
                </tr>
              )}
              {!trialQuery.isLoading &&
                !trialQuery.isError &&
                (trialQuery.data?.rows.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center opacity-60">
                      체험권이 없습니다.
                    </td>
                  </tr>
                )}
              {(trialQuery.data?.rows ?? []).map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-foreground/5 hover:bg-foreground/5 cursor-pointer"
                  onClick={() => navigate(`/members/${t.member_id}`)}
                >
                  <td className="px-4 py-3 font-medium">{t.member_name ?? t.member_id.slice(0, 8)}</td>
                  <td className="px-4 py-3 opacity-80">
                    {formatDateTime(t.start_at)} ~ {formatDateTime(t.end_at)}
                  </td>
                  <td className="px-4 py-3">
                    {t.used_entries} / {t.max_entries}
                  </td>
                  <td className="px-4 py-3">
                    <TrialStatusBadge status={t.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-4 py-2 -mb-px text-sm border-b-2 transition-colors",
        active
          ? "border-foreground font-semibold"
          : "border-transparent opacity-60 hover:opacity-100"
      )}
    >
      {children}
    </button>
  );
}

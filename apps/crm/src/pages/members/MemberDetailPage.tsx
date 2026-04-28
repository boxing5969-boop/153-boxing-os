import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Pause, X as Cancel, Receipt } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirmDialog";
import MemberStatusBadge from "@/components/members/MemberStatusBadge";
import {
  MembershipStatusBadge,
  PaymentStatusBadge,
  TrialStatusBadge,
} from "@/components/memberships/MembershipStatusBadge";
import { NewMembershipDialog } from "@/components/memberships/NewMembershipDialog";
import { NewTrialPassDialog } from "@/components/memberships/NewTrialPassDialog";
import { getMember, getMemberRelated } from "@/services/members";
import { updateMembershipState } from "@/services/memberships";
import { cancelTrialPass } from "@/services/trialPasses";
import { formatDate, formatDateTime, formatPhone, daysUntil } from "@/lib/format";
import type { Member, Membership, TrialPass } from "@153/shared";

type MembershipAction = "pause" | "cancel" | "refund";

interface PendingAction {
  type: MembershipAction;
  membership: Membership;
}

export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const memberId = id ?? "";
  const qc = useQueryClient();

  const memberQuery = useQuery({
    queryKey: ["member", memberId],
    queryFn: () => getMember(memberId),
    enabled: !!memberId,
  });

  const relatedQuery = useQuery({
    queryKey: ["member-related", memberId],
    queryFn: () => getMemberRelated(memberId),
    enabled: !!memberId,
  });

  const [openNewMembership, setOpenNewMembership] = useState(false);
  const [openNewTrial, setOpenNewTrial] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [trialToCancel, setTrialToCancel] = useState<TrialPass | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const membershipActionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: MembershipAction }) => {
      if (action === "pause") return updateMembershipState(id, { status: "paused" });
      if (action === "cancel") return updateMembershipState(id, { status: "canceled" });
      return updateMembershipState(id, { status: "canceled", payment_status: "refunded" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["member-related", memberId] });
      void qc.invalidateQueries({ queryKey: ["memberships"] });
      setPending(null);
      setActionError(null);
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : "처리 실패"),
  });

  const trialCancelMutation = useMutation({
    mutationFn: cancelTrialPass,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["member-related", memberId] });
      void qc.invalidateQueries({ queryKey: ["trialPasses"] });
      setTrialToCancel(null);
      setActionError(null);
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : "처리 실패"),
  });

  if (memberQuery.isLoading) {
    return <p className="text-sm opacity-60">로딩 중…</p>;
  }
  if (memberQuery.isError) {
    return (
      <p className="text-sm text-red-600">
        오류: {memberQuery.error instanceof Error ? memberQuery.error.message : "알 수 없는 오류"}
      </p>
    );
  }
  if (!memberQuery.data) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="회원을 찾을 수 없습니다"
          action={
            <Link to="/members">
              <Button variant="outline">
                <ArrowLeft className="size-4" />
                목록으로
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const member = memberQuery.data;
  const memberships = relatedQuery.data?.memberships ?? [];
  const trials = relatedQuery.data?.trials ?? [];
  const accessReady = computeAccessReady(member, memberships, trials);

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title={member.name}
        description={
          <span className="flex items-center gap-2">
            <MemberStatusBadge status={member.status} />
            <span className="opacity-60">가입 {formatDate(member.created_at)}</span>
          </span>
        }
        action={
          <Link to="/members">
            <Button variant="outline">
              <ArrowLeft className="size-4" />
              목록으로
            </Button>
          </Link>
        }
      />

      {actionError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold opacity-80">기본 정보</h2>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-y-2 text-sm">
              <dt className="opacity-60">전화</dt>
              <dd className="col-span-2">{formatPhone(member.phone)}</dd>
              <dt className="opacity-60">생년월일</dt>
              <dd className="col-span-2">{formatDate(member.birth_date)}</dd>
              <dt className="opacity-60">성별</dt>
              <dd className="col-span-2">{genderLabel(member.gender)}</dd>
              <dt className="opacity-60">담당 코치</dt>
              <dd className="col-span-2">
                {member.assigned_coach_id ? (
                  <span className="opacity-70">{member.assigned_coach_id.slice(0, 8)}…</span>
                ) : (
                  "미지정"
                )}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold opacity-80">출입 가능 여부</h2>
          </CardHeader>
          <CardContent>
            <p className={accessReady.allowed ? "text-green-700" : "text-red-700"}>
              {accessReady.allowed ? "출입 가능 ✓" : `출입 불가 — ${accessReady.reason}`}
            </p>
            <p className="mt-1 text-xs opacity-60">
              상태({member.status}) + 활성 이용권/체험권 기준
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold opacity-80">이용권</h2>
          <Button size="sm" onClick={() => setOpenNewMembership(true)}>
            <Plus className="size-4" />
            이용권 등록
          </Button>
        </CardHeader>
        <CardContent>
          {memberships.length === 0 ? (
            <p className="text-sm opacity-60">이용권 이력 없음</p>
          ) : (
            <ul className="divide-y divide-foreground/5">
              {memberships.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{m.plan_name}</div>
                    <div className="text-xs opacity-70">
                      {formatDate(m.start_date)} ~ {formatDate(m.end_date)}
                      {m.status === "active" && daysUntil(m.end_date) !== null && (
                        <span className="ml-2 opacity-80">({daysUntil(m.end_date)}일 남음)</span>
                      )}
                    </div>
                  </div>
                  <MembershipStatusBadge status={m.status} />
                  <PaymentStatusBadge status={m.payment_status} />
                  {m.status === "active" && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPending({ type: "pause", membership: m })}
                      >
                        <Pause className="size-3" />
                        정지
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPending({ type: "refund", membership: m })}
                      >
                        <Receipt className="size-3" />
                        환불
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setPending({ type: "cancel", membership: m })}
                      >
                        <Cancel className="size-3" />
                        취소
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold opacity-80">체험권</h2>
          <Button size="sm" variant="outline" onClick={() => setOpenNewTrial(true)}>
            <Plus className="size-4" />
            체험권 발급
          </Button>
        </CardHeader>
        <CardContent>
          {trials.length === 0 ? (
            <p className="text-sm opacity-60">체험권 없음</p>
          ) : (
            <ul className="divide-y divide-foreground/5">
              {trials.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      {formatDateTime(t.start_at)} ~ {formatDateTime(t.end_at)}
                    </div>
                    <div className="text-xs opacity-70">
                      사용 {t.used_entries} / {t.max_entries}회
                    </div>
                  </div>
                  <TrialStatusBadge status={t.status} />
                  {t.status === "active" && (
                    <Button size="sm" variant="destructive" onClick={() => setTrialToCancel(t)}>
                      <Cancel className="size-3" />
                      취소
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <NewMembershipDialog
        open={openNewMembership}
        onClose={() => setOpenNewMembership(false)}
        member={member}
      />
      <NewTrialPassDialog
        open={openNewTrial}
        onClose={() => setOpenNewTrial(false)}
        member={member}
      />

      <ConfirmDialog
        open={!!pending}
        onClose={() => {
          if (!membershipActionMutation.isPending) setPending(null);
        }}
        title={pending ? actionTitle(pending.type) : ""}
        description={
          pending ? (
            <span>
              <strong>{pending.membership.plan_name}</strong> ({formatDate(pending.membership.start_date)} ~{" "}
              {formatDate(pending.membership.end_date)}) 이용권을{" "}
              <strong>{actionWord(pending.type)}</strong> 처리합니다. 계속할까요?
            </span>
          ) : (
            ""
          )
        }
        confirmLabel={pending ? actionWord(pending.type) : "확인"}
        variant={pending?.type === "cancel" ? "destructive" : "default"}
        onConfirm={() => {
          if (pending) {
            membershipActionMutation.mutate({ id: pending.membership.id, action: pending.type });
          }
        }}
        pending={membershipActionMutation.isPending}
      />

      <ConfirmDialog
        open={!!trialToCancel}
        onClose={() => {
          if (!trialCancelMutation.isPending) setTrialToCancel(null);
        }}
        title="체험권 취소"
        description={
          trialToCancel ? (
            <span>
              {formatDateTime(trialToCancel.start_at)} 발급 체험권을 취소합니다. 계속할까요?
            </span>
          ) : (
            ""
          )
        }
        confirmLabel="취소"
        variant="destructive"
        onConfirm={() => {
          if (trialToCancel) trialCancelMutation.mutate(trialToCancel.id);
        }}
        pending={trialCancelMutation.isPending}
      />
    </div>
  );
}

function genderLabel(g: string | null): string {
  switch (g) {
    case "male":
      return "남";
    case "female":
      return "여";
    case "other":
      return "기타";
    default:
      return "—";
  }
}

function actionTitle(action: MembershipAction): string {
  if (action === "pause") return "이용권 정지";
  if (action === "refund") return "이용권 환불";
  return "이용권 취소";
}

function actionWord(action: MembershipAction): string {
  if (action === "pause") return "정지";
  if (action === "refund") return "환불";
  return "취소";
}

interface AccessCheck {
  allowed: boolean;
  reason?: string;
}

function computeAccessReady(
  member: Member,
  memberships: Membership[],
  trials: TrialPass[]
): AccessCheck {
  if (member.status === "expired") return { allowed: false, reason: "이용권 만료" };
  if (member.status === "unpaid") return { allowed: false, reason: "미납" };
  if (member.status === "suspended") return { allowed: false, reason: "정지" };
  if (member.status === "withdrawn") return { allowed: false, reason: "탈퇴" };

  const today = new Date().toISOString().slice(0, 10);
  const activeMembership = memberships.find(
    (m) =>
      m.status === "active" &&
      m.end_date >= today &&
      (m.payment_status === "paid" || m.payment_status === "partial")
  );
  if (activeMembership) return { allowed: true };

  const nowIso = new Date().toISOString();
  const activeTrial = trials.find(
    (t) => t.status === "active" && t.end_at >= nowIso && t.used_entries < t.max_entries
  );
  if (activeTrial) return { allowed: true };

  return { allowed: false, reason: "유효한 이용권/체험권 없음" };
}

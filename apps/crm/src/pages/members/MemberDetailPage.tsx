import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Plus, Pause, X as Cancel, Receipt,
  Phone, Calendar, User2, Link2, ShieldCheck, ShieldX,
} from "lucide-react";
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
import { ConsentManagementCard } from "@/components/consent/ConsentManagementCard";
import { LinkRankingAppDialog } from "@/components/members/LinkRankingAppDialog";
import { getMember, getMemberRelated } from "@/services/members";
import { updateMembershipState } from "@/services/memberships";
import { cancelTrialPass } from "@/services/trialPasses";
import { getAccessPreview, ACCESS_SOURCE_LABELS } from "@/services/access";
import { formatDate, formatDateTime, formatPhone, daysUntil } from "@/lib/format";
import { cn } from "@/lib/cn";
import { DENIED_REASON_LABELS, type Member, type Membership, type TrialPass } from "@153/shared";

type MembershipAction = "pause" | "cancel" | "refund";
interface PendingAction { type: MembershipAction; membership: Membership; }

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
function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}
function genderLabel(g: string | null) {
  return g === "male" ? "남" : g === "female" ? "여" : g === "other" ? "기타" : "—";
}
function actionTitle(a: MembershipAction) {
  return a === "pause" ? "이용권 정지" : a === "refund" ? "이용권 환불" : "이용권 취소";
}
function actionWord(a: MembershipAction) {
  return a === "pause" ? "정지" : a === "refund" ? "환불" : "취소";
}

interface AccessCheck { allowed: boolean; reason?: string; }
const BLOCK_REASON: Partial<Record<string, string>> = {
  expired: "이용권 만료",
  unpaid: "미납",
  suspended: "정지",
  withdrawn: "탈퇴",
};

function computeAccessReady(member: Member, memberships: Membership[], trials: TrialPass[]): AccessCheck {
  if (BLOCK_REASON[member.status])
    return { allowed: false, reason: BLOCK_REASON[member.status] };
  const today = new Date().toISOString().slice(0, 10);
  if (memberships.find((m) => m.status === "active" && m.end_date >= today && ["paid", "partial"].includes(m.payment_status)))
    return { allowed: true };
  const nowIso = new Date().toISOString();
  if (trials.find((t) => t.status === "active" && t.end_at >= nowIso && t.used_entries < t.max_entries))
    return { allowed: true };
  return { allowed: false, reason: "유효한 이용권/체험권 없음" };
}

export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const memberId = id ?? "";
  const qc = useQueryClient();

  const memberQuery = useQuery({ queryKey: ["member", memberId], queryFn: () => getMember(memberId), enabled: !!memberId });
  const relatedQuery = useQuery({ queryKey: ["member-related", memberId], queryFn: () => getMemberRelated(memberId), enabled: !!memberId });
  const accessPreviewQuery = useQuery({
    queryKey: ["access-preview", memberId],
    queryFn: () => getAccessPreview(memberId),
    enabled: !!memberId,
    staleTime: 30_000,
  });

  const [openNewMembership, setOpenNewMembership] = useState(false);
  const [openNewTrial, setOpenNewTrial] = useState(false);
  const [openLinkRanking, setOpenLinkRanking] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [trialToCancel, setTrialToCancel] = useState<TrialPass | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const membershipActionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: MembershipAction }) => {
      if (action === "pause") return updateMembershipState(id, { status: "paused" });
      if (action === "cancel") return updateMembershipState(id, { status: "canceled" });
      return updateMembershipState(id, { status: "canceled", payment_status: "refunded" });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["member-related", memberId] }); void qc.invalidateQueries({ queryKey: ["memberships"] }); void qc.invalidateQueries({ queryKey: ["access-preview", memberId] }); setPending(null); setActionError(null); },
    onError: (err) => setActionError(err instanceof Error ? err.message : "처리 실패"),
  });

  const trialCancelMutation = useMutation({
    mutationFn: cancelTrialPass,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["member-related", memberId] }); void qc.invalidateQueries({ queryKey: ["trialPasses"] }); void qc.invalidateQueries({ queryKey: ["access-preview", memberId] }); setTrialToCancel(null); setActionError(null); },
    onError: (err) => setActionError(err instanceof Error ? err.message : "처리 실패"),
  });

  if (memberQuery.isLoading) {
    return (
      <div className="space-y-4 max-w-4xl animate-pulse">
        <div className="h-36 rounded-xl bg-muted" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-48 rounded-xl bg-muted" />
          <div className="h-48 rounded-xl bg-muted" />
        </div>
      </div>
    );
  }
  if (!memberQuery.data) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <p className="text-lg font-semibold">회원을 찾을 수 없습니다</p>
        <Link to="/members"><Button variant="outline"><ArrowLeft className="size-4" />목록으로</Button></Link>
      </div>
    );
  }

  const member = memberQuery.data;
  const memberships = relatedQuery.data?.memberships ?? [];
  const trials = relatedQuery.data?.trials ?? [];
  const accessReadyFallback = computeAccessReady(member, memberships, trials);
  const previewData    = accessPreviewQuery.data;
  const previewError   = accessPreviewQuery.isError;
  const previewLoading = accessPreviewQuery.isLoading;
  const previewSource  = previewData?.allowed ? previewData.source : null;
  const accessAllowed  = previewData ? previewData.allowed : accessReadyFallback.allowed;
  const accessLabel = previewData
    ? previewData.allowed
      ? "출입 가능"
      : (DENIED_REASON_LABELS[previewData.reason] ?? previewData.message ?? "출입 불가")
    : (accessReadyFallback.allowed ? "출입 가능" : (accessReadyFallback.reason ?? "출입 불가"));
  const sourceLabel = previewSource ? ACCESS_SOURCE_LABELS[previewSource] : null;
  const accessSubStatus: { text: string; tone: "muted" | "warn" } | null =
    previewLoading
      ? { text: "서버 확인 중…", tone: "muted" }
      : previewError
        ? { text: "서버 확인 실패 — 임시 계산값 표시 중", tone: "warn" }
        : previewData
          ? { text: "서버 기준 확인됨", tone: "muted" }
          : null;

  return (
    <div className="space-y-5 max-w-4xl">
      {/* 뒤로 버튼 */}
      <Link to="/members" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="size-4" />
        회원 목록
      </Link>

      {/* 프로필 히어로 카드 */}
      <Card className="overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 p-6">
          {/* 아바타 */}
          <div className={cn(
            "flex size-16 shrink-0 items-center justify-center rounded-2xl text-2xl font-black",
            avatarColor(member.name)
          )}>
            {getInitials(member.name)}
          </div>

          {/* 이름 + 상태 */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-black text-foreground">{member.name}</h1>
              <MemberStatusBadge status={member.status} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Phone className="size-3.5" />
                {formatPhone(member.phone)}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                가입 {formatDate(member.created_at)}
              </span>
            </div>
          </div>

          {/* 출입 가능 여부 — 서버 access preview 우선, 응답 전엔 fallback */}
          <div className={cn(
            "flex flex-col items-stretch gap-1.5 rounded-xl px-4 py-2.5 shrink-0 min-w-[180px]",
            accessAllowed ? "bg-success/10" : "bg-danger/10"
          )}>
            <div className={cn(
              "flex items-center gap-2 text-sm font-semibold",
              accessAllowed ? "text-success" : "text-danger"
            )}>
              {accessAllowed
                ? <ShieldCheck className="size-4 shrink-0" />
                : <ShieldX className="size-4 shrink-0" />}
              <span className="truncate">{accessLabel}</span>
            </div>

            {(sourceLabel || accessSubStatus) && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-tight">
                {sourceLabel && (
                  <span className={cn(
                    "inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-bold",
                    accessAllowed
                      ? "bg-success/20 text-success"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {sourceLabel}
                  </span>
                )}
                {accessSubStatus && (
                  <span className={cn(
                    accessSubStatus.tone === "warn"
                      ? "text-warning"
                      : "text-muted-foreground"
                  )}>
                    {accessSubStatus.text}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-4 py-3">
          <div className="size-1.5 rounded-full bg-danger shrink-0" />
          <p className="text-sm text-danger">{actionError}</p>
        </div>
      )}

      {/* 기본 정보 */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <User2 className="size-4 text-muted-foreground" />
            기본 정보
          </h2>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            {[
              { label: "생년월일", value: formatDate(member.birth_date) },
              { label: "성별", value: genderLabel(member.gender) },
              { label: "담당 코치", value: member.assigned_coach_id ? member.assigned_coach_id.slice(0, 8) + "…" : "미지정" },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                <p className="font-medium text-foreground">{value}</p>
              </div>
            ))}
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">랭킹업 연결</p>
              <div className="flex items-center gap-2">
                {member.ranking_app_user_id ? (
                  <span className="flex items-center gap-1 font-mono text-xs text-primary">
                    <Link2 className="size-3" />
                    {member.ranking_app_user_id.slice(0, 8)}…
                  </span>
                ) : (
                  <span className="text-muted-foreground">미연결</span>
                )}
                <Button size="sm" variant="ghost" onClick={() => setOpenLinkRanking(true)} className="h-6 px-2 text-xs">
                  변경
                </Button>
              </div>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* 이용권 */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">이용권</h2>
          <Button size="sm" onClick={() => setOpenNewMembership(true)} className="gap-1.5">
            <Plus className="size-3.5" />
            이용권 등록
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {memberships.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-muted-foreground">이용권 이력이 없습니다</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {memberships.map((m) => {
                const remaining = m.status === "active" ? daysUntil(m.end_date) : null;
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{m.plan_name}</span>
                        {remaining != null && remaining <= 7 && (
                          <span className="text-xs rounded-full bg-warning/10 text-warning px-2 py-0.5 font-medium">
                            D-{remaining}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 tabular">
                        {formatDate(m.start_date)} ~ {formatDate(m.end_date)}
                        {remaining != null && <span className="ml-2">({remaining}일 남음)</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <MembershipStatusBadge status={m.status} />
                      <PaymentStatusBadge status={m.payment_status} />
                    </div>
                    {m.status === "active" && (
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" onClick={() => setPending({ type: "pause", membership: m })} className="gap-1">
                          <Pause className="size-3" /> 정지
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setPending({ type: "refund", membership: m })} className="gap-1">
                          <Receipt className="size-3" /> 환불
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setPending({ type: "cancel", membership: m })} className="gap-1">
                          <Cancel className="size-3" /> 취소
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 체험권 */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">체험권</h2>
          <Button size="sm" variant="outline" onClick={() => setOpenNewTrial(true)} className="gap-1.5">
            <Plus className="size-3.5" />
            체험권 발급
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {trials.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-muted-foreground">체험권이 없습니다</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {trials.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground tabular">
                      {formatDateTime(t.start_at)} ~ {formatDateTime(t.end_at)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${t.max_entries === 0 ? 0 : (t.used_entries / t.max_entries) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{t.used_entries}/{t.max_entries}회 사용</span>
                    </div>
                  </div>
                  <TrialStatusBadge status={t.status} />
                  {t.status === "active" && (
                    <Button size="sm" variant="destructive" onClick={() => setTrialToCancel(t)} className="gap-1">
                      <Cancel className="size-3" /> 취소
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 동의 관리 */}
      <ConsentManagementCard memberId={member.id} />

      {/* 다이얼로그들 */}
      <LinkRankingAppDialog open={openLinkRanking} onClose={() => setOpenLinkRanking(false)} member={member} />
      <NewMembershipDialog open={openNewMembership} onClose={() => setOpenNewMembership(false)} member={member} />
      <NewTrialPassDialog open={openNewTrial} onClose={() => setOpenNewTrial(false)} member={member} />

      <ConfirmDialog
        open={!!pending}
        onClose={() => { if (!membershipActionMutation.isPending) setPending(null); }}
        title={pending ? actionTitle(pending.type) : ""}
        description={pending ? <span><strong>{pending.membership.plan_name}</strong> 이용권을 <strong>{actionWord(pending.type)}</strong> 처리합니다. 계속할까요?</span> : ""}
        confirmLabel={pending ? actionWord(pending.type) : "확인"}
        variant={pending?.type === "cancel" ? "destructive" : "default"}
        onConfirm={() => { if (pending) membershipActionMutation.mutate({ id: pending.membership.id, action: pending.type }); }}
        pending={membershipActionMutation.isPending}
      />
      <ConfirmDialog
        open={!!trialToCancel}
        onClose={() => { if (!trialCancelMutation.isPending) setTrialToCancel(null); }}
        title="체험권 취소"
        description={trialToCancel ? <span>{formatDateTime(trialToCancel.start_at)} 발급 체험권을 취소합니다. 계속할까요?</span> : ""}
        confirmLabel="취소"
        variant="destructive"
        onConfirm={() => { if (trialToCancel) trialCancelMutation.mutate(trialToCancel.id); }}
        pending={trialCancelMutation.isPending}
      />
    </div>
  );
}

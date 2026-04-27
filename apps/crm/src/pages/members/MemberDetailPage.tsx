import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import MemberStatusBadge from "@/components/members/MemberStatusBadge";
import { getMember, getMemberRelated } from "@/services/members";
import { formatDate, formatDateTime, formatPhone, daysUntil } from "@/lib/format";
import type { Member, Membership, TrialPass } from "@153/shared";

export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const memberId = id ?? "";

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
              상태({memberStatusToText(member.status)}) + 활성 이용권/체험권 기준
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold opacity-80">이용권</h2>
          <span className="text-xs opacity-60">PR 5.3 에서 등록/연장/정지</span>
        </CardHeader>
        <CardContent>
          {memberships.length === 0 ? (
            <p className="text-sm opacity-60">이용권 이력 없음</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {memberships.map((m) => (
                <li key={m.id} className="flex items-center justify-between border-b border-foreground/5 pb-2 last:border-b-0 last:pb-0">
                  <span>
                    <strong>{m.plan_name}</strong>{" "}
                    <span className="opacity-60">
                      ({formatDate(m.start_date)} ~ {formatDate(m.end_date)})
                    </span>
                  </span>
                  <span className="text-xs">
                    {membershipStatusText(m)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold opacity-80">체험권</h2>
        </CardHeader>
        <CardContent>
          {trials.length === 0 ? (
            <p className="text-sm opacity-60">체험권 없음</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {trials.map((t) => (
                <li key={t.id} className="flex items-center justify-between border-b border-foreground/5 pb-2 last:border-b-0 last:pb-0">
                  <span>
                    {formatDateTime(t.start_at)} ~ {formatDateTime(t.end_at)}{" "}
                    <span className="opacity-60">
                      ({t.used_entries}/{t.max_entries}회)
                    </span>
                  </span>
                  <span className="text-xs opacity-70">{t.status}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
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

function memberStatusToText(s: Member["status"]): string {
  return s;
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

function membershipStatusText(m: Membership): string {
  const remaining = daysUntil(m.end_date);
  if (m.status === "active" && remaining !== null && remaining > 0) {
    return `${m.status} · ${remaining}일 남음 · ${m.payment_status}`;
  }
  return `${m.status} · ${m.payment_status}`;
}

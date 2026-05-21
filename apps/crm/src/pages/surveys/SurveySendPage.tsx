/**
 * 설문 발송 페이지 (/surveys/:id/send)
 * - 회원에게 개인 설문 링크를 SMS/카카오로 발송한다.
 * - 발송 대상 선택 · 채널 선택 · 메시지 작성 · 미리보기 · 발송 결과 · 추적 통계
 */
import { useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Send, Search, Users, Link2, Copy, Check,
  CheckCircle2, AlertTriangle, MessageSquare, BarChart3,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import {
  getSurveyTemplate, listSurveyQrCodes, buildSurveyUrl,
  sendSurvey, getSurveyInviteStats,
  SURVEY_CHANNEL_LABELS, DEFAULT_SURVEY_MESSAGE,
  type SurveyChannel, type SurveySendReport, type SurveySendDryRun,
  type SurveyQrCode, type SurveyInviteRow,
} from "@/services/surveys";
import { listMembers } from "@/services/members";
import type { Member, MemberStatus } from "@153/shared";
import { cn } from "@/lib/cn";

// ── 상수 ──────────────────────────────────────────────────────
const CHANNELS: SurveyChannel[] = [
  "sms", "kakao", "both", "kakao_sms_fallback", "app_push", "email", "manual",
];
const AUTO_SEND = new Set<SurveyChannel>(["sms", "kakao", "both", "kakao_sms_fallback"]);

const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: "유효", trial: "체험", expired: "만료",
  suspended: "정지", unpaid: "미납", withdrawn: "탈퇴",
};
const STATUS_FILTERS: (MemberStatus | "all")[] = ["all", "active", "trial", "expired", "unpaid"];

const INVITE_STATUS: Record<string, { label: string; cls: string }> = {
  pending:   { label: "대기",   cls: "bg-muted text-muted-foreground" },
  sent:      { label: "발송됨", cls: "bg-primary/10 text-primary" },
  opened:    { label: "열람",   cls: "bg-warning/10 text-warning" },
  responded: { label: "응답완료", cls: "bg-success/10 text-success" },
  failed:    { label: "실패",   cls: "bg-danger/10 text-danger" },
};

function isReport(r: SurveySendReport | SurveySendDryRun): r is SurveySendReport {
  return "links" in r;
}

// ════════════════════════════════════════════════════════════
// 메시지 미리보기
// ════════════════════════════════════════════════════════════
function previewMessage(content: string, branchName: string): string {
  return content
    .replace(/#{회원명}/g, "홍길동")
    .replace(/#{지점명}/g, branchName)
    .replace(/#{설문링크}/g, "https://…/s/xxxx?t=개인링크");
}

// ════════════════════════════════════════════════════════════
// 발송 결과 패널
// ════════════════════════════════════════════════════════════
function ResultPanel({ report }: { report: SurveySendReport }) {
  const [copied, setCopied] = useState<string | null>(null);
  const linkOnly = report.links.filter((l) => l.status === "pending" && l.url);

  return (
    <Card className="border-success/30">
      <CardHeader className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-success" />
        <span className="text-sm font-bold text-foreground">발송 완료</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-success/5 p-3 text-center">
            <p className="text-2xl font-black text-success">{report.sent}</p>
            <p className="text-xs text-muted-foreground">발송 성공</p>
          </div>
          <div className="rounded-lg bg-danger/5 p-3 text-center">
            <p className="text-2xl font-black text-danger">{report.failed}</p>
            <p className="text-xs text-muted-foreground">실패</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-2xl font-black text-foreground">{report.skipped}</p>
            <p className="text-xs text-muted-foreground">링크 생성</p>
          </div>
        </div>

        {linkOnly.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              아래 개인 링크를 복사해 이메일·앱·메신저로 직접 전달하세요.
            </p>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {linkOnly.map((l) => (
                <div key={l.member_id} className="flex items-center gap-2 px-3 py-2 text-xs">
                  <span className="w-16 shrink-0 font-medium text-foreground truncate">{l.member_name}</span>
                  <span className="flex-1 truncate text-muted-foreground">{l.url}</span>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(l.url);
                      setCopied(l.member_id);
                      setTimeout(() => setCopied(null), 1500);
                    }}
                    className="shrink-0 rounded p-1 hover:bg-muted"
                  >
                    {copied === l.member_id
                      ? <Check className="size-3.5 text-success" />
                      : <Copy className="size-3.5 text-muted-foreground" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {report.failed > 0 && (
          <div className="space-y-1">
            {report.links.filter((l) => l.status === "failed").map((l) => (
              <p key={l.member_id} className="text-xs text-danger">
                · {l.member_name}: {l.error ?? "발송 실패"}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════
// 발송 추적 통계 패널
// ════════════════════════════════════════════════════════════
function StatsPanel({ templateId }: { templateId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["survey-invite-stats", templateId],
    queryFn: () => getSurveyInviteStats(templateId),
  });

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-xl bg-muted" />;
  }
  if (!data || data.counts.total === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          아직 발송 이력이 없습니다.
        </CardContent>
      </Card>
    );
  }

  const c = data.counts;
  const respRate = c.sent > 0 ? Math.round((c.responded / c.sent) * 100) : 0;

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <BarChart3 className="size-4 text-primary" />
        <span className="text-sm font-bold text-foreground">발송 / 응답 추적</span>
        <span className="ml-auto text-xs text-muted-foreground">응답률 {respRate}%</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-2 text-center">
          {([
            ["발송", c.sent, "text-primary"],
            ["열람", c.opened, "text-warning"],
            ["응답", c.responded, "text-success"],
            ["실패", c.failed, "text-danger"],
          ] as const).map(([label, n, cls]) => (
            <div key={label} className="rounded-lg bg-muted/40 py-2">
              <p className={cn("text-xl font-black", cls)}>{n}</p>
              <p className="text-[11px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {data.recent.map((r: SurveyInviteRow) => {
            const s = INVITE_STATUS[r.status] ?? INVITE_STATUS["pending"]!;
            return (
              <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="w-16 shrink-0 font-medium text-foreground truncate">{r.member_name}</span>
                <span className="flex-1 text-muted-foreground">
                  {SURVEY_CHANNEL_LABELS[r.channel] ?? r.channel}
                </span>
                <span className={cn("rounded-full px-2 py-0.5 font-medium", s.cls)}>{s.label}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════
// 메인 페이지
// ════════════════════════════════════════════════════════════
export default function SurveySendPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const qc = useQueryClient();

  const [qrId, setQrId] = useState<string>("");
  const [channel, setChannel] = useState<SurveyChannel>("sms");
  const [content, setContent] = useState<string>(DEFAULT_SURVEY_MESSAGE);
  const [statusFilter, setStatusFilter] = useState<MemberStatus | "all">("active");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendErr, setSendErr] = useState<string | null>(null);

  // 설문 템플릿
  const { data: template } = useQuery({
    queryKey: ["survey-template", id],
    queryFn: () => getSurveyTemplate(id!),
    enabled: !!id,
  });

  // QR 링크 목록
  const { data: qrCodes } = useQuery({
    queryKey: ["survey-qr", id],
    queryFn: () => listSurveyQrCodes(id!),
    enabled: !!id,
  });

  const activeQrs = useMemo(
    () => (qrCodes ?? []).filter((q: SurveyQrCode) => q.status === "active"),
    [qrCodes]
  );
  const firstQr = activeQrs[0];
  const effectiveQrId = qrId || firstQr?.id || "";

  // 대상 회원 목록 (설문 지점 기준)
  const branchId = template?.branch_id ?? "";
  const { data: memberData } = useQuery({
    queryKey: ["send-members", branchId, statusFilter],
    queryFn: () =>
      listMembers({
        branch_id: branchId,
        status: statusFilter === "all" ? null : statusFilter,
        limit: 500,
      }),
    enabled: !!branchId,
  });

  const members = useMemo(() => {
    const rows = memberData?.rows ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (m: Member) =>
        m.name.toLowerCase().includes(q) || (m.phone ?? "").includes(q)
    );
  }, [memberData, search]);

  const branchName = "우리 지점"; // 미리보기용 (실제 발송 시 서버가 정확한 지점명 치환)

  // 발송
  const sendMutation = useMutation({
    mutationFn: () =>
      sendSurvey({
        qr_code_id: effectiveQrId,
        member_ids: [...selected],
        channel,
        content,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["survey-invite-stats", id] });
      setSelected(new Set());
    },
    onError: (e) => setSendErr(e instanceof Error ? e.message : "발송 실패"),
  });

  const result = sendMutation.data;
  const hasLink = content.includes("#{설문링크}");
  const canSend =
    !!effectiveQrId && selected.size > 0 && content.trim().length > 0 && hasLink;

  function toggle(memberId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === members.length
        ? new Set()
        : new Set(members.map((m) => m.id))
    );
  }

  if (!id) return null;

  return (
    <div className="space-y-5 pb-10">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-foreground">설문 발송</h1>
          <p className="text-sm text-muted-foreground truncate">
            {template?.title ?? "설문"}
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* ── 좌측: 발송 설정 ───────────────────────────── */}
        <div className="space-y-5">
          {/* QR 링크 선택 */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <Link2 className="size-4 text-primary" />
              <span className="text-sm font-bold text-foreground">1. 설문 링크</span>
            </CardHeader>
            <CardContent>
              {activeQrs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  활성 설문 링크가 없습니다.{" "}
                  <Link to={`/surveys/${id}`} className="text-primary hover:underline">
                    설문 상세 → QR 관리
                  </Link>
                  에서 먼저 발급해 주세요.
                </p>
              ) : (
                <select
                  value={effectiveQrId}
                  onChange={(e) => setQrId(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                >
                  {activeQrs.map((q: SurveyQrCode) => (
                    <option key={q.id} value={q.id}>
                      {q.label ?? "기본 링크"} — /s/{q.slug}
                    </option>
                  ))}
                </select>
              )}
            </CardContent>
          </Card>

          {/* 채널 선택 */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <Send className="size-4 text-primary" />
              <span className="text-sm font-bold text-foreground">2. 발송 채널</span>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch}
                    onClick={() => setChannel(ch)}
                    className={cn(
                      "rounded-lg border-2 px-3 py-2 text-xs font-semibold text-left transition-all",
                      channel === ch
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    {SURVEY_CHANNEL_LABELS[ch]}
                  </button>
                ))}
              </div>
              {channel === "kakao" || channel === "both" || channel === "kakao_sms_fallback" ? (
                <p className="text-[11px] text-warning">
                  ⚠ 알림톡은 카카오 사전 승인 템플릿(kakao_tpl_survey)이 지점에 설정되어야 발송됩니다.
                </p>
              ) : null}
              {!AUTO_SEND.has(channel) && (
                <p className="text-[11px] text-muted-foreground">
                  이 채널은 자동 발송 없이 개인 링크만 생성합니다. 발송 후 링크를 복사해 전달하세요.
                </p>
              )}
            </CardContent>
          </Card>

          {/* 메시지 작성 */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <MessageSquare className="size-4 text-primary" />
              <span className="text-sm font-bold text-foreground">3. 안내 문구</span>
            </CardHeader>
            <CardContent className="space-y-2">
              <textarea
                rows={5}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex flex-wrap gap-1.5">
                {["#{회원명}", "#{지점명}", "#{설문링크}"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setContent((c) => c + v)}
                    className="rounded-md bg-muted px-2 py-1 text-[11px] font-mono text-muted-foreground hover:bg-muted/70"
                  >
                    {v}
                  </button>
                ))}
              </div>
              {!hasLink && (
                <p className="text-[11px] text-danger">
                  #{"{설문링크}"} 변수를 반드시 포함해야 회원이 설문에 접속할 수 있습니다.
                </p>
              )}
              <div className="rounded-lg bg-muted/40 border border-border p-3">
                <p className="text-[11px] font-semibold text-muted-foreground mb-1">미리보기</p>
                <p className="text-xs text-foreground whitespace-pre-wrap">
                  {previewMessage(content, branchName)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* 대상 회원 선택 */}
          <Card>
            <CardHeader className="flex items-center gap-2">
              <Users className="size-4 text-primary" />
              <span className="text-sm font-bold text-foreground">4. 대상 회원</span>
              <span className="ml-auto text-xs font-semibold text-primary">
                {selected.size}명 선택
              </span>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {STATUS_FILTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                      statusFilter === s
                        ? "bg-primary text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted/70"
                    )}
                  >
                    {s === "all" ? "전체" : MEMBER_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="이름 · 전화번호 검색"
                  className="w-full rounded-lg border border-input bg-background pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <button
                onClick={toggleAll}
                className="text-xs font-medium text-primary hover:underline"
              >
                {selected.size === members.length && members.length > 0
                  ? "전체 해제"
                  : `전체 선택 (${members.length}명)`}
              </button>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {members.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    해당 조건의 회원이 없습니다.
                  </p>
                ) : (
                  members.map((m: Member) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={() => toggle(m.id)}
                        className="rounded border-border"
                      />
                      <span className="text-sm font-medium text-foreground">{m.name}</span>
                      <span className="text-xs text-muted-foreground">{m.phone ?? "번호없음"}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {MEMBER_STATUS_LABELS[m.status]}
                      </span>
                    </label>
                  ))
                )}
              </div>
              {AUTO_SEND.has(channel) && (
                <p className="text-[11px] text-muted-foreground">
                  연락처가 없는 회원은 발송 실패로 기록됩니다.
                </p>
              )}
            </CardContent>
          </Card>

          {/* 발송 버튼 */}
          {sendErr && (
            <div className="rounded-lg bg-danger/5 border border-danger/20 px-4 py-3 text-xs text-danger">
              {sendErr}
            </div>
          )}
          <Button
            size="lg"
            className="w-full"
            disabled={!canSend || sendMutation.isPending}
            onClick={() => { setSendErr(null); sendMutation.mutate(); }}
          >
            {sendMutation.isPending ? (
              "발송 중…"
            ) : (
              <>
                <Send className="size-4" />
                {selected.size}명에게 설문 발송
              </>
            )}
          </Button>
        </div>

        {/* ── 우측: 결과 + 통계 ─────────────────────────── */}
        <div className="space-y-5">
          {result && isReport(result) && <ResultPanel report={result} />}
          <StatsPanel templateId={id} />
          {firstQr && (
            <Card>
              <CardContent className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground">공개 설문 주소</p>
                <p className="text-xs text-foreground break-all">
                  {buildSurveyUrl(firstQr.slug)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  QR·게시용 공용 링크입니다. 회원별 추적은 위에서 발송하세요.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {profile && profile.role === "coach" && (
        <p className="text-xs text-warning flex items-center gap-1">
          <AlertTriangle className="size-3.5" /> 발송 권한은 관리자에게 있습니다.
        </p>
      )}
    </div>
  );
}

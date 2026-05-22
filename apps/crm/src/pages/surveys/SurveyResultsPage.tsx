/**
 * 설문 결과 분석 페이지 (/surveys/:id/results)
 * - 요약 KPI: 응답 수 / 평균 만족도 / NPS / 코치 만족도 / 시설 만족도
 * - 낮은 점수 응답 카드 + 후속관리 (followup 생성/상태 변경)
 * - 주관식(개선 의견) 목록
 */
import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, AlertTriangle, MessageSquare,
  ThumbsUp, ThumbsDown, Minus,
  CheckCircle2, Clock, XCircle, ChevronDown, ChevronUp,
  BarChart3, Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getSurveyTemplate,
  getSurveyResponseList,
  createFollowup, updateFollowup,
  calcAvgByKeyword, calcNps, filterLowScoreResponses, extractTextAnswers,
  type SurveyResponseDetail, type ResponseFollowup, type NpsResult,
} from "@/services/surveys";
import { cn } from "@/lib/cn";

// ── KPI 카드 ─────────────────────────────────────────────────
function KpiCard({
  label, value, sub, tone = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const textCls = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    danger:  "text-danger",
  }[tone];
  return (
    <div className="rounded-2xl border border-border bg-card shadow-card p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-black tabular", textCls)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── NPS 게이지 ────────────────────────────────────────────────
function NpsGauge({ nps }: { nps: NpsResult }) {
  const tone = nps.score >= 50 ? "success" : nps.score >= 0 ? "warning" : "danger";
  return (
    <div className="rounded-2xl border border-border bg-card shadow-card p-4 space-y-3">
      <p className="text-xs text-muted-foreground">NPS (지인 추천 지수)</p>
      <div className="flex items-end gap-3">
        <p className={cn("text-2xl font-black tabular", {
          "text-success": tone === "success",
          "text-warning": tone === "warning",
          "text-danger":  tone === "danger",
        })}>
          {nps.score > 0 ? `+${nps.score}` : nps.score}
        </p>
        <p className="text-xs text-muted-foreground pb-0.5">/ 응답 {nps.total}건</p>
      </div>
      {/* 막대 */}
      <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
        <div
          className="bg-success rounded-l-full"
          style={{ width: `${(nps.promoters / nps.total) * 100}%` }}
        />
        <div
          className="bg-muted"
          style={{ width: `${(nps.passives / nps.total) * 100}%` }}
        />
        <div
          className="bg-danger rounded-r-full"
          style={{ width: `${(nps.detractors / nps.total) * 100}%` }}
        />
      </div>
      <div className="flex gap-4 text-[11px]">
        <span className="flex items-center gap-1 text-success">
          <ThumbsUp className="size-3" /> 추천 {nps.promoters}
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Minus className="size-3" /> 중립 {nps.passives}
        </span>
        <span className="flex items-center gap-1 text-danger">
          <ThumbsDown className="size-3" /> 비추 {nps.detractors}
        </span>
      </div>
    </div>
  );
}

// ── 후속관리 상태 뱃지 ────────────────────────────────────────
const FOLLOWUP_STATUS = {
  pending:     { label: "대기", icon: Clock,         cls: "bg-warning/10 text-warning" },
  in_progress: { label: "처리 중", icon: Clock,      cls: "bg-blue-50 text-blue-600" },
  resolved:    { label: "해결됨", icon: CheckCircle2, cls: "bg-success/10 text-success" },
  dismissed:   { label: "닫힘", icon: XCircle,       cls: "bg-muted text-muted-foreground" },
} as const;

type FollowupStatus = keyof typeof FOLLOWUP_STATUS;

function FollowupBadge({ status }: { status: FollowupStatus }) {
  const m = FOLLOWUP_STATUS[status];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", m.cls)}>
      <Icon className="size-3" />
      {m.label}
    </span>
  );
}

// ── 낮은 점수 응답 카드 ───────────────────────────────────────
function LowScoreCard({
  response,
  branchId,
  onFollowupChange,
}: {
  response: SurveyResponseDetail;
  branchId: string;
  onFollowupChange: () => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showFollowupForm, setShowFollowupForm] = useState(false);
  const [notes, setNotes] = useState(response.followup?.notes ?? "");
  const [statusDraft, setStatusDraft] = useState<FollowupStatus>(
    (response.followup?.status as FollowupStatus | undefined) ?? "pending"
  );

  const createMutation = useMutation({
    mutationFn: () => createFollowup({ response_id: response.id, branch_id: branchId, notes }),
    onSuccess: () => { setShowFollowupForm(false); onFollowupChange(); },
  });

  const updateMutation = useMutation({
    mutationFn: () => updateFollowup(response.followup!.id, { status: statusDraft, notes }),
    onSuccess: () => { setShowFollowupForm(false); onFollowupChange(); },
  });

  const dateStr = new Date(response.submitted_at).toLocaleDateString("ko-KR", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* 헤더 행 */}
      <div className="flex items-center gap-3 px-4 py-3">
        <AlertTriangle className="size-4 text-danger shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-foreground">{dateStr}</span>
            {response.respondent_phone && (
              <span className="text-[10px] text-muted-foreground">{response.respondent_phone}</span>
            )}
          </div>
          {/* 점수 미리보기 */}
          <div className="flex gap-3 mt-0.5 flex-wrap">
            {response.answers
              .filter((a) => a.answer_score != null)
              .map((a) => {
                const opts = a.options as { max?: number } | null;
                const max = opts?.max ?? 5;
                const isLow = max >= 10 ? a.answer_score! <= 6 : a.answer_score! <= 2;
                return (
                  <span key={a.question_id} className={cn("text-[10px]", isLow ? "text-danger font-semibold" : "text-muted-foreground")}>
                    {a.question_text.slice(0, 8)}… {a.answer_score}/{max}
                  </span>
                );
              })}
          </div>
        </div>
        {/* 후속관리 뱃지 */}
        {response.followup && (
          <FollowupBadge status={response.followup.status as FollowupStatus} />
        )}
        <button onClick={() => setExpanded((v) => !v)} className="p-1 text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>

      {/* 펼쳐진 상세 */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-3 bg-muted/10">
          {/* 전체 답변 */}
          <div className="space-y-2">
            {response.answers.map((a) => (
              <div key={a.question_id} className="text-xs">
                <span className="text-muted-foreground">{a.question_text}: </span>
                {a.answer_score != null && (
                  <span className="font-semibold text-foreground">
                    {a.answer_score}점
                  </span>
                )}
                {a.answer_text && (
                  <span className="text-foreground">{a.answer_text}</span>
                )}
              </div>
            ))}
          </div>

          {/* 후속관리 폼 */}
          {showFollowupForm ? (
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex gap-2">
                <select
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value as FollowupStatus)}
                  className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {(Object.keys(FOLLOWUP_STATUS) as FollowupStatus[]).map((k) => (
                    <option key={k} value={k}>{FOLLOWUP_STATUS[k].label}</option>
                  ))}
                </select>
              </div>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="처리 내용 메모"
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => (response.followup ? updateMutation.mutate() : createMutation.mutate())}
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending ? "저장 중…" : "저장"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowFollowupForm(false)}>
                  취소
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {response.followup?.notes && (
                <p className="text-xs text-muted-foreground flex-1">메모: {response.followup.notes}</p>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowFollowupForm(true)}
                className="text-xs"
              >
                {response.followup ? "후속관리 수정" : "후속관리 등록"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// 메인 페이지
// ════════════════════════════════════════════════════════════
export default function SurveyResultsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const qc = useQueryClient();

  const branchId = profile?.branch_id ?? "";

  // 설문 템플릿
  const { data: template, isLoading: tmplLoading } = useQuery({
    queryKey: ["survey-template", id],
    queryFn: () => getSurveyTemplate(id!),
    enabled: !!id,
    staleTime: 120_000,
  });

  // 응답 목록 (RPC)
  const { data: responseData, isLoading: rLoading, refetch } = useQuery({
    queryKey: ["survey-response-list", id],
    queryFn: () => getSurveyResponseList(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

  const responses = responseData?.responses ?? [];

  // 분석 계산
  const avgSatisfaction = (() => {
    const keywords = ["만족도", "수업", "운동"];
    const scores: number[] = [];
    for (const r of responses) {
      for (const a of r.answers) {
        if (a.answer_score != null && a.question_type === "rating") {
          const opts = a.options as { max?: number } | null;
          if ((opts?.max ?? 5) <= 5 && keywords.some((k) => a.question_text.includes(k))) {
            scores.push(a.answer_score);
          }
        }
      }
    }
    if (!scores.length) return null;
    return Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
  })();

  const coachAvg   = calcAvgByKeyword(responses, "코치");
  const facilityAvg = calcAvgByKeyword(responses, "시설");
  const npsResult  = calcNps(responses);
  const lowScores  = filterLowScoreResponses(responses);
  const textAnswers = extractTextAnswers(responses);

  const isLoading = tmplLoading || rLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        설문을 찾을 수 없습니다.{" "}
        <Link to="/surveys" className="text-primary hover:underline">목록으로</Link>
      </div>
    );
  }

  const scoreTone = (v: number | null, max = 5): "success" | "warning" | "danger" | "default" => {
    if (v == null) return "default";
    const ratio = v / max;
    if (ratio >= 0.8) return "success";
    if (ratio >= 0.6) return "warning";
    return "danger";
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(`/surveys/${id}`)}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="size-5 text-primary" />
            <h1 className="text-xl font-black text-foreground">{template.title} — 결과</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            전체 {responseData?.total ?? 0}건 응답
          </p>
        </div>
      </div>

      {/* KPI 그리드 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard
          label="전체 응답"
          value={responseData?.total ?? 0}
          sub="건"
          tone="default"
        />
        <KpiCard
          label="평균 만족도"
          value={avgSatisfaction != null ? `${avgSatisfaction}/5` : "—"}
          sub="수업·운동 만족도 평균"
          tone={scoreTone(avgSatisfaction)}
        />
        <KpiCard
          label="코치 만족도"
          value={coachAvg != null ? `${coachAvg}/5` : "—"}
          sub="코치 관련 질문 평균"
          tone={scoreTone(coachAvg)}
        />
        <KpiCard
          label="시설 만족도"
          value={facilityAvg != null ? `${facilityAvg}/5` : "—"}
          sub="시설·청결 관련 평균"
          tone={scoreTone(facilityAvg)}
        />
        <KpiCard
          label="낮은 점수 응답"
          value={lowScores.length}
          sub="후속관리 필요"
          tone={lowScores.length > 0 ? "danger" : "default"}
        />
      </div>

      {/* NPS */}
      {npsResult && (
        <NpsGauge nps={npsResult} />
      )}

      {/* ── 낮은 점수 응답 ────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="size-4 text-danger" />
          <h2 className="text-sm font-semibold text-foreground">
            낮은 점수 응답
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              (별점 ≤ 2/5 또는 NPS ≤ 6/10)
            </span>
          </h2>
          <span className="ml-auto text-xs text-danger font-medium">{lowScores.length}건</span>
        </div>

        {lowScores.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            낮은 점수 응답이 없습니다 👍
          </div>
        ) : (
          <div className="space-y-2">
            {lowScores.map((r) => (
              <LowScoreCard
                key={r.id}
                response={r}
                branchId={branchId}
                onFollowupChange={() => void qc.invalidateQueries({ queryKey: ["survey-response-list", id] })}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── 개선 의견 (주관식) ───────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">
            개선 의견
          </h2>
          <span className="ml-auto text-xs text-muted-foreground">{textAnswers.length}건</span>
        </div>

        {textAnswers.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            주관식 답변이 없습니다.
          </div>
        ) : (
          <div className="space-y-2">
            {textAnswers.map((ta, i) => (
              <div key={`${ta.responseId}-${i}`} className="rounded-2xl border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground mb-1">
                  {new Date(ta.submittedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                  {ta.questionText && (
                    <span className="ml-2 text-[10px]">· {ta.questionText}</span>
                  )}
                </p>
                <p className="text-sm text-foreground leading-relaxed">{ta.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 전체 응답 요약 ────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Users className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">전체 응답 목록</h2>
          <span className="ml-auto text-xs text-muted-foreground">{responses.length}건</span>
        </div>

        {responses.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            아직 응답이 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-xs">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">일시</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">연락처</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">별점 평균</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">NPS</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">후속관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {responses.map((r) => {
                  const ratingAnswers = r.answers.filter((a) => {
                    const opts = a.options as { max?: number } | null;
                    return a.answer_score != null && (opts?.max ?? 5) <= 5;
                  });
                  const avgRating = ratingAnswers.length
                    ? Math.round(
                        (ratingAnswers.reduce((s, a) => s + (a.answer_score ?? 0), 0) / ratingAnswers.length) * 10
                      ) / 10
                    : null;
                  const npsAns = r.answers.find((a) => {
                    const opts = a.options as { max?: number } | null;
                    return a.answer_score != null && (opts?.max ?? 5) >= 10;
                  });

                  return (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(r.submitted_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.respondent_phone ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {avgRating != null ? (
                          <span className={cn("font-medium", avgRating <= 2 ? "text-danger" : avgRating <= 3.5 ? "text-warning" : "text-success")}>
                            {avgRating}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {npsAns?.answer_score != null ? (
                          <span className={cn("font-medium", npsAns.answer_score <= 6 ? "text-danger" : npsAns.answer_score <= 8 ? "text-warning" : "text-success")}>
                            {npsAns.answer_score}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.followup ? (
                          <FollowupBadge status={r.followup.status as FollowupStatus} />
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * 공개 설문 응답 페이지 — /s/:slug  (?t={token} 개인 링크 지원)
 *
 * 두 가지 모드:
 *   1) 공용 링크 (?t 없음)   — getPublicSurvey / submitPublicSurvey
 *   2) 개인 링크 (?t=token) — getSurveyInvite / submitSurveyViaInvite (회원 자동 귀속)
 *
 * UX: 한 화면 한 질문 · 진행바 · 부드러운 전환 · 자동 진행 · 회원 인사말
 * - ProtectedRoute 밖: 로그인 없이 접근 가능
 * - anon Supabase key만 사용
 */
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CheckCircle2, AlertTriangle, ChevronRight, ChevronLeft,
  Star, Sparkles, ThumbsUp,
} from "lucide-react";
import {
  getPublicSurvey, submitPublicSurvey,
  getSurveyInvite, submitSurveyViaInvite,
  type PublicSurveyQuestion, type AnswerInput,
} from "@/services/surveys";
import { cn } from "@/lib/cn";

// 전환 애니메이션 (공개 페이지 — 독립 레이아웃이라 style 주입 OK)
const ANIM_CSS = `
@keyframes surveyIn {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}
.survey-anim { animation: surveyIn .32s cubic-bezier(.22,.61,.36,1); }
@keyframes pop {
  0% { transform: scale(.8); }
  60% { transform: scale(1.12); }
  100% { transform: scale(1); }
}
.survey-pop { animation: pop .26s ease-out; }
`;

// ── 진행바 ────────────────────────────────────────────────────
function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
        style={{ width: `${Math.max(4, Math.min(100, value))}%` }}
      />
    </div>
  );
}

// ── 별점 입력 (1~max, 별 아이콘) ──────────────────────────────
function RatingPicker({
  value, max = 5, onChange,
}: { value: number | null; max?: number; onChange: (v: number) => void }) {
  return (
    <div className="flex justify-center gap-2.5">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const on = value != null && n <= value;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              "transition-transform active:scale-90",
              value === n && "survey-pop"
            )}
            aria-label={`${n}점`}
          >
            <Star
              className={cn(
                "size-11 transition-colors",
                on ? "fill-warning text-warning" : "text-border"
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

// ── NPS 입력 (0~10 컬러 스케일) ───────────────────────────────
function NpsPicker({
  value, onChange,
}: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
        {Array.from({ length: 11 }, (_, i) => i).map((n) => {
          const active = value === n;
          const tone = n <= 6 ? "danger" : n <= 8 ? "warning" : "success";
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={cn(
                "aspect-square rounded-xl border-2 text-sm font-bold transition-all active:scale-90",
                active && "survey-pop",
                active
                  ? tone === "danger"
                    ? "border-danger bg-danger text-white"
                    : tone === "warning"
                      ? "border-warning bg-warning text-white"
                      : "border-success bg-success text-white"
                  : "border-border text-muted-foreground hover:border-primary"
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground px-1">
        <span>전혀 추천 안 함</span>
        <span>적극 추천</span>
      </div>
    </div>
  );
}

// ── 예/아니오 입력 ────────────────────────────────────────────
function YesNoPicker({
  value, onChange,
}: { value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {[
        { label: "예", icon: "👍" },
        { label: "아니오", icon: "🤔" },
      ].map(({ label, icon }) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(label)}
          className={cn(
            "rounded-2xl border-2 py-6 text-base font-bold transition-all active:scale-95",
            value === label
              ? "border-primary bg-primary/10 text-primary survey-pop"
              : "border-border text-muted-foreground hover:border-primary/50"
          )}
        >
          <span className="block text-2xl mb-1">{icon}</span>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── 한 질문 화면 ──────────────────────────────────────────────
function QuestionView({
  q, index, total, answer, onAnswer,
}: {
  q: PublicSurveyQuestion;
  index: number;
  total: number;
  answer: AnswerInput;
  onAnswer: (a: Partial<AnswerInput>, autoNext?: boolean) => void;
}) {
  const opts = q.options as { min?: number; max?: number } | null;
  const max = opts?.max ?? 5;
  const isNps = q.question_type === "multiple_choice" && max >= 10;

  return (
    <div className="survey-anim space-y-7">
      <div className="space-y-2">
        <p className="text-xs font-bold text-primary uppercase tracking-widest">
          질문 {index + 1} / {total}
        </p>
        <h2 className="text-xl font-black text-foreground leading-snug">
          {q.question_text}
          {q.is_required && <span className="ml-1 text-danger">*</span>}
        </h2>
      </div>

      {q.question_type === "rating" && (
        <RatingPicker
          value={answer.answer_score ?? null}
          max={max}
          onChange={(v) => onAnswer({ answer_score: v }, true)}
        />
      )}

      {q.question_type === "multiple_choice" &&
        (isNps ? (
          <NpsPicker
            value={answer.answer_score ?? null}
            onChange={(v) => onAnswer({ answer_score: v }, true)}
          />
        ) : (
          <RatingPicker
            value={answer.answer_score ?? null}
            max={max}
            onChange={(v) => onAnswer({ answer_score: v }, true)}
          />
        ))}

      {q.question_type === "yes_no" && (
        <YesNoPicker
          value={answer.answer_text ?? null}
          onChange={(v) => onAnswer({ answer_text: v }, true)}
        />
      )}

      {q.question_type === "text" && (
        <textarea
          rows={5}
          autoFocus
          value={answer.answer_text ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
            onAnswer({ answer_text: e.target.value })
          }
          placeholder="자유롭게 의견을 들려주세요"
          className="w-full rounded-2xl border-2 border-input bg-background px-4 py-3.5 text-base resize-none focus:outline-none focus:border-primary"
        />
      )}
    </div>
  );
}

// ── 오류 메시지 ───────────────────────────────────────────────
const ERROR_MESSAGES: Record<string, string> = {
  QR_NOT_FOUND: "유효하지 않은 설문 링크입니다.",
  QR_INACTIVE: "이 설문은 현재 비활성 상태입니다.",
  QR_EXPIRED: "설문 기간이 만료되었습니다.",
  QR_NOT_YET_VALID: "아직 설문이 시작되지 않았습니다.",
  SURVEY_INACTIVE: "이 설문은 현재 운영 중이 아닙니다.",
  INVITE_NOT_FOUND: "유효하지 않은 설문 링크입니다.",
};

function ErrorScreen({ code }: { code: string }) {
  const msg = ERROR_MESSAGES[code] ?? "설문을 불러올 수 없습니다.";
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center space-y-3">
      <AlertTriangle className="size-11 text-warning" />
      <p className="text-base font-semibold text-foreground">{msg}</p>
      <p className="text-xs text-muted-foreground">{code}</p>
    </div>
  );
}

// ── 공통 레이아웃 ─────────────────────────────────────────────
function Shell({
  branchName, progress, children,
}: {
  branchName: string;
  progress: number;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <style>{ANIM_CSS}</style>
      <div className="mx-auto max-w-lg px-4 py-6">
        {/* 브랜드 + 진행바 */}
        <div className="mb-6 space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <span className="text-[11px] font-black text-primary">153</span>
            </div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              {branchName}
            </span>
          </div>
          <ProgressBar value={progress} />
        </div>
        {children}
        <p className="mt-10 text-center text-[10px] text-muted-foreground/50">
          Powered by 153 Boxing OS
        </p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// 메인 페이지
// ════════════════════════════════════════════════════════════
type Step = "intro" | number | "review" | "done";

export default function PublicSurveyPage() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const token = params.get("t");
  const inviteMode = !!token;

  // 설문 로드 — 개인 토큰 우선
  const { data: result, isLoading } = useQuery({
    queryKey: ["survey", inviteMode ? `t:${token}` : `s:${slug}`],
    queryFn: () =>
      inviteMode ? getSurveyInvite(token!) : getPublicSurvey(slug!),
    enabled: inviteMode ? !!token : !!slug,
    staleTime: 300_000,
    retry: false,
  });

  const [answers, setAnswers] = useState<Record<string, AnswerInput>>({});
  const [phone, setPhone] = useState("");
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [step, setStep] = useState<Step>("intro");
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const data = result && result.success ? result.data : null;
  const questions = useMemo(() => data?.questions ?? [], [data]);
  const memberName =
    data && "member_name" in data ? (data.member_name as string | null) : null;
  const alreadyResponded =
    data && "already_responded" in data
      ? (data.already_responded as boolean)
      : false;

  const submitMutation = useMutation({
    mutationFn: () => {
      const list: AnswerInput[] = questions.map((q) => ({
        question_id: q.id,
        answer_text: answers[q.id]?.answer_text ?? null,
        answer_score: answers[q.id]?.answer_score ?? null,
      }));
      return inviteMode
        ? submitSurveyViaInvite(token!, list)
        : submitPublicSurvey(slug!, list, phone.trim() || undefined);
    },
    onSuccess: (res) => {
      if (res.success) setStep("done");
      else setSubmitErr(res.error ?? "제출에 실패했습니다.");
    },
    onError: (e) => setSubmitErr(e instanceof Error ? e.message : "제출 오류"),
  });

  // 단계 전환 시 상단 스크롤
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  // ── 로딩 ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">설문 로딩 중…</div>
      </div>
    );
  }

  // ── 오류 ─────────────────────────────────────────────────
  if (!result || !result.success || !data) {
    return (
      <div className="min-h-screen bg-background">
        <style>{ANIM_CSS}</style>
        <div className="mx-auto max-w-lg px-4">
          <ErrorScreen code={result && !result.success ? result.error : "LOAD_ERROR"} />
        </div>
      </div>
    );
  }

  const totalQ = questions.length;
  const answeredCount = questions.filter((q) => {
    const a = answers[q.id];
    return a?.answer_score != null || !!a?.answer_text?.trim();
  }).length;

  function setAnswer(qId: string, partial: Partial<AnswerInput>, autoNext = false) {
    setAnswers((prev) => ({
      ...prev,
      [qId]: { ...(prev[qId] ?? { question_id: qId }), ...partial },
    }));
    if (autoNext) {
      window.setTimeout(() => {
        setStep((s) =>
          typeof s === "number" ? (s + 1 >= totalQ ? "review" : s + 1) : s
        );
      }, 340);
    }
  }

  function curQuestionValid(qIdx: number): boolean {
    const q = questions[qIdx];
    if (!q || !q.is_required) return true;
    const a = answers[q.id];
    if (q.question_type === "text" || q.question_type === "yes_no") {
      return !!a?.answer_text?.trim();
    }
    return a?.answer_score != null;
  }

  function allValid(): boolean {
    for (let i = 0; i < totalQ; i++) if (!curQuestionValid(i)) return false;
    return true;
  }

  const progress =
    step === "intro" ? 0
      : step === "review" || step === "done" ? 100
        : ((step as number) / totalQ) * 100;

  // ════════ 인트로 화면 ════════
  if (step === "intro") {
    return (
      <Shell branchName={data.branch_name} progress={progress}>
        <div className="survey-anim flex flex-col items-center text-center space-y-5 py-8">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
            <Sparkles className="size-8 text-primary" />
          </div>
          <div className="space-y-2">
            {memberName && (
              <p className="text-sm font-bold text-primary">{memberName}님, 안녕하세요!</p>
            )}
            <h1 className="text-2xl font-black text-foreground">{data.template.title}</h1>
            {data.template.description && (
              <p className="text-sm text-muted-foreground">{data.template.description}</p>
            )}
          </div>
          <div className="rounded-xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
            질문 {totalQ}개 · 약 1분 소요
          </div>
          {alreadyResponded ? (
            <div className="w-full rounded-xl bg-success/5 border border-success/20 px-4 py-3 text-sm text-success">
              이미 응답을 완료하셨습니다. 감사합니다!
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setStep(0)}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary py-4 text-sm font-bold text-white shadow-lg shadow-primary/20 active:scale-[.98] transition-transform"
            >
              설문 시작하기 <ChevronRight className="size-4" />
            </button>
          )}
        </div>
      </Shell>
    );
  }

  // ════════ 완료 화면 ════════
  if (step === "done") {
    return (
      <Shell branchName={data.branch_name} progress={100}>
        <div className="survey-anim flex flex-col items-center justify-center py-16 text-center space-y-4">
          <div className="flex size-20 items-center justify-center rounded-full bg-success/10 survey-pop">
            <CheckCircle2 className="size-11 text-success" />
          </div>
          <div>
            <p className="text-xl font-black text-foreground">소중한 의견 감사합니다!</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.branch_name}이(가) 더 나은 서비스로 보답하겠습니다.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">이 창을 닫으셔도 됩니다.</p>
        </div>
      </Shell>
    );
  }

  // ════════ 검토/제출 화면 ════════
  if (step === "review") {
    const canSubmit =
      allValid() && (inviteMode || privacyAgreed) && !submitMutation.isPending;
    return (
      <Shell branchName={data.branch_name} progress={100}>
        <div className="survey-anim space-y-5">
          <div className="flex items-center gap-2">
            <ThumbsUp className="size-5 text-primary" />
            <h2 className="text-lg font-black text-foreground">마지막 단계예요</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {answeredCount}/{totalQ}개 질문에 답해 주셨습니다.
            {!allValid() && " 필수 질문을 모두 채워주세요."}
          </p>

          {!inviteMode && (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  연락처{" "}
                  <span className="text-xs text-muted-foreground">(선택 · 불편사항 후속 연락용)</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
                  placeholder="010-0000-0000"
                  className="w-full rounded-xl border-2 border-input bg-background px-4 py-3 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div className="rounded-xl bg-muted/40 border border-border p-4 space-y-3">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">개인정보 수집 및 이용 안내</strong><br />
                  수집 항목: 연락처(선택), 응답 내용 · 수집 목적: 서비스 품질 개선 및 불편사항 후속 처리 ·
                  보유 기간: 수집일로부터 1년. 거부 시 연락처 미제공으로 참여 가능합니다.
                </p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={privacyAgreed}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setPrivacyAgreed(e.target.checked)
                    }
                    className="rounded border-border"
                  />
                  <span className="text-xs font-medium text-foreground">
                    위 내용에 동의합니다 <span className="text-danger">*</span>
                  </span>
                </label>
              </div>
            </>
          )}

          {submitErr && (
            <div className="rounded-xl bg-danger/5 border border-danger/20 px-4 py-3 text-xs text-danger">
              {submitErr}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(totalQ - 1)}
              className="flex items-center justify-center gap-1 rounded-xl border-2 border-border px-4 py-4 text-sm font-semibold text-muted-foreground"
            >
              <ChevronLeft className="size-4" /> 이전
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => { setSubmitErr(null); submitMutation.mutate(); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 rounded-xl py-4 text-sm font-bold transition-all",
                canSubmit
                  ? "bg-primary text-white shadow-lg shadow-primary/20 active:scale-[.98]"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {submitMutation.isPending ? "제출 중…" : "설문 제출하기"}
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  // ════════ 질문 화면 ════════
  const idx = step as number;
  const q = questions[idx]!;
  const canNext = curQuestionValid(idx);

  return (
    <Shell branchName={data.branch_name} progress={progress}>
      <QuestionView
        key={idx}
        q={q}
        index={idx}
        total={totalQ}
        answer={answers[q.id] ?? { question_id: q.id }}
        onAnswer={(partial, autoNext) => setAnswer(q.id, partial, autoNext)}
      />
      <div className="mt-9 flex gap-2">
        <button
          type="button"
          onClick={() => setStep(idx === 0 ? "intro" : idx - 1)}
          className="flex items-center justify-center gap-1 rounded-xl border-2 border-border px-4 py-3.5 text-sm font-semibold text-muted-foreground"
        >
          <ChevronLeft className="size-4" /> 이전
        </button>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => setStep(idx + 1 >= totalQ ? "review" : idx + 1)}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3.5 text-sm font-bold transition-all",
            canNext
              ? "bg-primary text-white active:scale-[.98]"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {idx + 1 >= totalQ ? "완료" : "다음"}
          <ChevronRight className="size-4" />
        </button>
      </div>
    </Shell>
  );
}

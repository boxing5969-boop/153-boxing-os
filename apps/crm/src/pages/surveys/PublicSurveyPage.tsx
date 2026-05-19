/**
 * 공개 설문 응답 페이지 — /s/:slug
 * - ProtectedRoute 밖: 로그인 없이 접근 가능
 * - anon Supabase key만 사용 (service_role key 프론트 노출 금지)
 * - get_public_survey RPC → 설문 로드
 * - submit_survey_response RPC → 응답 저장
 */
import { useState, type ChangeEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, ChevronRight } from "lucide-react";
import {
  getPublicSurvey, submitPublicSurvey,
  type PublicSurveyQuestion, type AnswerInput,
} from "@/services/surveys";
import { cn } from "@/lib/cn";

// ── 평점 입력 (1~5 별모양 숫자 버튼) ─────────────────────────
function RatingInput({
  value,
  max = 5,
  onChange,
}: {
  value: number | null;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex gap-2">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={cn(
            "flex size-10 items-center justify-center rounded-full border-2 text-sm font-bold transition-all",
            value === n
              ? "border-primary bg-primary text-white"
              : "border-border text-muted-foreground hover:border-primary hover:text-primary"
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

// ── NPS 입력 (0~10 수평 척도) ─────────────────────────────────
function NpsInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1 flex-wrap">
        {Array.from({ length: 11 }, (_, i) => i).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              "flex size-9 items-center justify-center rounded-lg border text-xs font-semibold transition-all",
              value === n
                ? n <= 6
                  ? "border-danger bg-danger text-white"
                  : n <= 8
                    ? "border-warning bg-warning text-white"
                    : "border-success bg-success text-white"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground px-0.5">
        <span>전혀 추천 안 함</span>
        <span>적극 추천</span>
      </div>
    </div>
  );
}

// ── 예/아니오 입력 ────────────────────────────────────────────
function YesNoInput({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-3">
      {["예", "아니오"].map((label) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(label)}
          className={cn(
            "flex-1 rounded-xl border-2 py-3 text-sm font-semibold transition-all",
            value === label
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/50"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── 질문 렌더러 ───────────────────────────────────────────────
function QuestionBlock({
  q,
  index,
  answer,
  onAnswer,
}: {
  q: PublicSurveyQuestion;
  index: number;
  answer: AnswerInput;
  onAnswer: (a: Partial<AnswerInput>) => void;
}) {
  const opts = q.options as { min?: number; max?: number } | null;
  const max = opts?.max ?? 5;

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-foreground">
        <span className="text-muted-foreground mr-1.5">{index + 1}.</span>
        {q.question_text}
        {q.is_required && <span className="ml-1 text-danger text-xs">*</span>}
      </p>

      {q.question_type === "rating" && (
        <RatingInput
          value={answer.answer_score ?? null}
          max={max}
          onChange={(v) => onAnswer({ answer_score: v })}
        />
      )}

      {q.question_type === "multiple_choice" && (
        // NPS 스타일로 처리 (0~10 척도는 options.max=10으로 구분)
        max >= 10 ? (
          <NpsInput
            value={answer.answer_score ?? null}
            onChange={(v) => onAnswer({ answer_score: v })}
          />
        ) : (
          <RatingInput
            value={answer.answer_score ?? null}
            max={max}
            onChange={(v) => onAnswer({ answer_score: v })}
          />
        )
      )}

      {q.question_type === "yes_no" && (
        <YesNoInput
          value={answer.answer_text ?? null}
          onChange={(v) => onAnswer({ answer_text: v })}
        />
      )}

      {q.question_type === "text" && (
        <textarea
          rows={4}
          value={answer.answer_text ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
            onAnswer({ answer_text: e.target.value })
          }
          placeholder="의견을 자유롭게 적어주세요"
          className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
      )}
    </div>
  );
}

// ── 완료 화면 ─────────────────────────────────────────────────
function ThankYouScreen({ branchName }: { branchName: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center space-y-4">
      <div className="flex size-16 items-center justify-center rounded-full bg-success/10">
        <CheckCircle2 className="size-9 text-success" />
      </div>
      <div>
        <p className="text-xl font-black text-foreground">소중한 의견 감사합니다!</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {branchName}이(가) 더 나은 서비스를 위해 노력하겠습니다.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">이 창을 닫으셔도 됩니다.</p>
    </div>
  );
}

// ── 오류 화면 ─────────────────────────────────────────────────
const ERROR_MESSAGES: Record<string, string> = {
  QR_NOT_FOUND: "유효하지 않은 설문 링크입니다.",
  QR_INACTIVE:  "이 설문은 현재 비활성 상태입니다.",
  QR_EXPIRED:   "설문 기간이 만료되었습니다.",
  QR_NOT_YET_VALID: "아직 설문이 시작되지 않았습니다.",
  SURVEY_INACTIVE: "이 설문은 현재 운영 중이 아닙니다.",
};

function ErrorScreen({ code }: { code: string }) {
  const msg = ERROR_MESSAGES[code] ?? "설문을 불러올 수 없습니다.";
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center space-y-3">
      <AlertTriangle className="size-10 text-warning" />
      <p className="text-base font-semibold text-foreground">{msg}</p>
      <p className="text-xs text-muted-foreground">{code}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// 메인 페이지
// ════════════════════════════════════════════════════════════
export default function PublicSurveyPage() {
  const { slug } = useParams<{ slug: string }>();

  // 설문 데이터 로드
  const { data: surveyResult, isLoading } = useQuery({
    queryKey: ["public-survey", slug],
    queryFn: () => getPublicSurvey(slug!),
    enabled: !!slug,
    staleTime: 300_000, // 5분
    retry: false,
  });

  // 답변 상태: { [questionId]: { answer_text, answer_score } }
  const [answers, setAnswers] = useState<Record<string, AnswerInput>>({});
  const [phone, setPhone] = useState("");
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submitMutation = useMutation({
    mutationFn: () => {
      const answerList: AnswerInput[] = questions.map((q) => ({
        question_id: q.id,
        answer_text: answers[q.id]?.answer_text ?? null,
        answer_score: answers[q.id]?.answer_score ?? null,
      }));
      return submitPublicSurvey(slug!, answerList, phone.trim() || undefined);
    },
    onSuccess: (res) => {
      if (res.success) {
        setDone(true);
      } else {
        setSubmitErr(res.error ?? "제출에 실패했습니다.");
      }
    },
    onError: (e) => setSubmitErr(e instanceof Error ? e.message : "제출 오류"),
  });

  // ── 로딩 ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">설문 로딩 중…</div>
      </div>
    );
  }

  // ── 오류 ─────────────────────────────────────────────────
  if (!surveyResult || !surveyResult.success) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-lg px-4 py-8">
          <ErrorScreen code={surveyResult?.error ?? "LOAD_ERROR"} />
        </div>
      </div>
    );
  }

  const { data } = surveyResult;
  const questions = data.questions ?? [];

  // ── 제출 완료 ─────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-lg px-4 py-8">
          <ThankYouScreen branchName={data.branch_name} />
        </div>
      </div>
    );
  }

  // ── 유효성 검사 ───────────────────────────────────────────
  function isValid(): boolean {
    if (!privacyAgreed) return false;
    for (const q of questions) {
      if (!q.is_required) continue;
      const a = answers[q.id];
      if (q.question_type === "rating" || q.question_type === "multiple_choice") {
        if (a?.answer_score == null) return false;
      } else {
        if (!a?.answer_text?.trim()) return false;
      }
    }
    return true;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="mx-auto max-w-lg px-4 py-8 pb-24">

        {/* 헤더 */}
        <div className="mb-8 text-center space-y-1">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 mx-auto mb-3">
            <span className="text-sm font-black text-primary">153</span>
          </div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            {data.branch_name}
          </p>
          <h1 className="text-2xl font-black text-foreground">{data.template.title}</h1>
          {data.template.description && (
            <p className="text-sm text-muted-foreground">{data.template.description}</p>
          )}
        </div>

        {/* 질문 목록 */}
        <div className="space-y-8">
          {questions.map((q, i) => (
            <QuestionBlock
              key={q.id}
              q={q}
              index={i}
              answer={answers[q.id] ?? { question_id: q.id }}
              onAnswer={(partial) =>
                setAnswers((prev) => ({
                  ...prev,
                  [q.id]: { ...(prev[q.id] ?? { question_id: q.id }), ...partial },
                }))
              }
            />
          ))}
        </div>

        {/* 선택 연락처 */}
        <div className="mt-10 space-y-2">
          <label className="block text-sm font-medium text-foreground">
            연락처 <span className="text-muted-foreground text-xs">(선택 · 불편사항 후속 연락용)</span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
            placeholder="010-0000-0000"
            className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* 개인정보 동의 */}
        <div className="mt-5 rounded-xl bg-muted/40 border border-border p-4 space-y-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <strong className="text-foreground">개인정보 수집 및 이용 안내</strong><br />
            수집 항목: 연락처(선택), 응답 내용<br />
            수집 목적: 서비스 품질 개선 및 불편사항 후속 처리<br />
            보유 기간: 수집일로부터 1년<br />
            귀하는 개인정보 제공을 거부할 권리가 있으며, 거부 시 연락처 미제공으로 참여 가능합니다.
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
              위 내용을 확인하였으며 동의합니다 <span className="text-danger">*</span>
            </span>
          </label>
        </div>

        {/* 오류 메시지 */}
        {submitErr && (
          <div className="mt-4 rounded-xl bg-danger/5 border border-danger/20 px-4 py-3 text-xs text-danger">
            {submitErr}
          </div>
        )}

        {/* 제출 버튼 */}
        <button
          type="button"
          disabled={!isValid() || submitMutation.isPending}
          onClick={() => submitMutation.mutate()}
          className={cn(
            "mt-6 w-full flex items-center justify-center gap-2 rounded-xl py-4 text-sm font-bold transition-all",
            isValid() && !submitMutation.isPending
              ? "bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {submitMutation.isPending ? (
            <span className="animate-pulse">제출 중…</span>
          ) : (
            <>
              설문 제출하기
              <ChevronRight className="size-4" />
            </>
          )}
        </button>

        {/* 하단 출처 */}
        <p className="mt-6 text-center text-[10px] text-muted-foreground/50">
          Powered by 153 Boxing OS
        </p>
      </div>
    </div>
  );
}

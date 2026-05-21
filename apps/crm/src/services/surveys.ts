/**
 * 회원만족 설문 서비스 레이어
 * - Supabase 직접 호출 (Workers API 없음)
 * - survey_templates / survey_questions / survey_qr_codes / survey_responses
 */
import { supabase } from "@/integrations/supabase/client";

// ── 타입 ──────────────────────────────────────────────────────

export type QuestionType = "rating" | "multiple_choice" | "text" | "yes_no";
export type SurveyStatus = "active" | "inactive" | "archived";
export type QrStatus = "active" | "inactive";
export type FollowupStatus = "pending" | "in_progress" | "resolved" | "dismissed";

export interface SurveyQuestion {
  id: string;
  survey_template_id: string;
  order_index: number;
  question_type: QuestionType;
  question_text: string;
  options: unknown | null;
  is_required: boolean;
  created_at: string;
}

export interface SurveyTemplate {
  id: string;
  branch_id: string;
  title: string;
  description: string | null;
  status: SurveyStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SurveyQrCode {
  id: string;
  branch_id: string;
  survey_template_id: string;
  slug: string;
  token: string;
  label: string | null;
  valid_from: string;
  valid_until: string | null;
  status: QrStatus;
  created_by: string | null;
  created_at: string;
}

export interface SurveyResponse {
  id: string;
  qr_code_id: string;
  branch_id: string;
  survey_template_id: string;
  member_id: string | null;
  respondent_phone: string | null;
  submitted_at: string;
}

// 기본 5개 질문 템플릿
export const DEFAULT_QUESTIONS: Omit<SurveyQuestion, "id" | "survey_template_id" | "created_at">[] = [
  {
    order_index: 0,
    question_type: "rating",
    question_text: "전반적인 만족도는 어떠셨나요?",
    options: { min: 1, max: 5, labels: { "1": "매우 불만족", "5": "매우 만족" } },
    is_required: true,
  },
  {
    order_index: 1,
    question_type: "rating",
    question_text: "코치/직원의 친절도는 어떠셨나요?",
    options: { min: 1, max: 5, labels: { "1": "매우 불만족", "5": "매우 만족" } },
    is_required: true,
  },
  {
    order_index: 2,
    question_type: "rating",
    question_text: "시설 청결도는 어떠셨나요?",
    options: { min: 1, max: 5, labels: { "1": "매우 불만족", "5": "매우 만족" } },
    is_required: true,
  },
  {
    order_index: 3,
    question_type: "rating",
    question_text: "수업 품질은 어떠셨나요?",
    options: { min: 1, max: 5, labels: { "1": "매우 불만족", "5": "매우 만족" } },
    is_required: true,
  },
  {
    order_index: 4,
    question_type: "yes_no",
    question_text: "주변에 추천하시겠습니까?",
    options: null,
    is_required: true,
  },
];

// ── 설문 템플릿 CRUD ──────────────────────────────────────────

export async function listSurveyTemplates(branchId: string): Promise<SurveyTemplate[]> {
  const { data, error } = await supabase
    .from("survey_templates" as "members") // DB 타입 미갱신 → 캐스팅 우회
    .select("*")
    .eq("branch_id", branchId)
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as SurveyTemplate[];
}

export async function getSurveyTemplate(id: string): Promise<SurveyTemplate | null> {
  const { data, error } = await supabase
    .from("survey_templates" as "members")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as SurveyTemplate | null;
}

export interface CreateSurveyInput {
  branch_id: string;
  title: string;
  description?: string;
  created_by?: string;
}

/** 설문 생성 + 기본 질문 5개 동시 삽입 */
export async function createSurveyWithDefaults(input: CreateSurveyInput): Promise<SurveyTemplate> {
  // 1. 템플릿 생성
  const { data: tmpl, error: tmplErr } = await supabase
    .from("survey_templates" as "members")
    .insert({
      branch_id: input.branch_id,
      title: input.title,
      description: input.description ?? null,
      created_by: input.created_by ?? null,
      status: "active",
    })
    .select()
    .single();
  if (tmplErr) throw tmplErr;
  const template = tmpl as unknown as SurveyTemplate;

  // 2. 기본 질문 삽입
  const questions = DEFAULT_QUESTIONS.map((q) => ({
    ...q,
    survey_template_id: template.id,
  }));
  const { error: qErr } = await supabase
    .from("survey_questions" as "members")
    .insert(questions as unknown as Record<string, unknown>[]);
  if (qErr) throw qErr;

  return template;
}

export async function updateSurveyTemplate(
  id: string,
  body: Partial<Pick<SurveyTemplate, "title" | "description" | "status">>
): Promise<SurveyTemplate> {
  const { data, error } = await supabase
    .from("survey_templates" as "members")
    .update(body as unknown as Record<string, unknown>)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as SurveyTemplate;
}

// ── 설문 질문 CRUD ────────────────────────────────────────────

export async function listSurveyQuestions(templateId: string): Promise<SurveyQuestion[]> {
  const { data, error } = await supabase
    .from("survey_questions" as "members")
    .select("*")
    .eq("survey_template_id", templateId)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as SurveyQuestion[];
}

export interface UpsertQuestionInput {
  id?: string;
  survey_template_id: string;
  order_index: number;
  question_type: QuestionType;
  question_text: string;
  options: unknown | null;
  is_required: boolean;
}

export async function upsertSurveyQuestion(
  q: UpsertQuestionInput
): Promise<SurveyQuestion> {
  const { data, error } = await supabase
    .from("survey_questions" as "members")
    .upsert(q as unknown as Record<string, unknown>)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as SurveyQuestion;
}

export async function deleteSurveyQuestion(id: string): Promise<void> {
  const { error } = await supabase
    .from("survey_questions" as "members")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// ── QR 코드 CRUD ──────────────────────────────────────────────

export async function listSurveyQrCodes(templateId: string): Promise<SurveyQrCode[]> {
  const { data, error } = await supabase
    .from("survey_qr_codes" as "members")
    .select("*")
    .eq("survey_template_id", templateId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as SurveyQrCode[];
}

export interface CreateQrInput {
  branch_id: string;
  survey_template_id: string;
  label?: string;
  valid_until?: string | null;
  created_by?: string;
}

export async function createSurveyQrCode(input: CreateQrInput): Promise<SurveyQrCode> {
  // 지점 정보 누락 방어 — 빈 문자열이 UUID 컬럼에 들어가면 발급 실패
  if (!input.branch_id) {
    throw new Error("지점 정보를 찾을 수 없어 QR을 발급할 수 없습니다.");
  }
  const { data, error } = await supabase
    .from("survey_qr_codes" as "members")
    .insert({
      branch_id: input.branch_id,
      survey_template_id: input.survey_template_id,
      label: input.label ?? null,
      valid_until: input.valid_until ?? null,
      created_by: input.created_by || null,
      status: "active",
    })
    .select()
    .single();
  if (error) throw error;
  return data as unknown as SurveyQrCode;
}

export async function updateSurveyQrCode(
  id: string,
  body: Partial<Pick<SurveyQrCode, "label" | "valid_until" | "status">>
): Promise<SurveyQrCode> {
  const { data, error } = await supabase
    .from("survey_qr_codes" as "members")
    .update(body as unknown as Record<string, unknown>)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as SurveyQrCode;
}

// ── 응답 통계 ─────────────────────────────────────────────────

export async function getSurveyResponseCount(templateId: string): Promise<number> {
  const { count, error } = await supabase
    .from("survey_responses" as "members")
    .select("*", { count: "exact", head: true })
    .eq("survey_template_id", templateId);
  if (error) throw error;
  return count ?? 0;
}

/** 설문 공개 URL 생성 (앱 도메인 기반) */
export function buildSurveyUrl(slug: string): string {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const base = env["VITE_SURVEY_BASE_URL"] ?? window.location.origin;
  return `${base}/s/${slug}`;
}

// ── 공개 설문 (anon 접근) ─────────────────────────────────────

export interface PublicSurveyQuestion {
  id: string;
  order_index: number;
  question_type: QuestionType;
  question_text: string;
  options: unknown | null;
  is_required: boolean;
}

export interface PublicSurveyData {
  qr_code_id: string;
  branch_name: string;
  template: {
    id: string;
    title: string;
    description: string | null;
  };
  questions: PublicSurveyQuestion[];
}

export interface PublicSurveyResult {
  success: true;
  data: PublicSurveyData;
}

export interface PublicSurveyError {
  success: false;
  error: string;
}

/** slug로 공개 설문 데이터 조회 (anon RPC) */
export async function getPublicSurvey(
  slug: string
): Promise<PublicSurveyResult | PublicSurveyError> {
  const { data, error } = await supabase.rpc(
    "get_public_survey" as "get_survey_results_summary", // DB 타입 미갱신 우회
    { p_slug: slug } as unknown as { p_survey_template_id: string }
  );
  if (error) return { success: false, error: error.message };
  const result = data as unknown as { success: boolean; error?: string } & Partial<PublicSurveyData>;
  if (!result.success) return { success: false, error: result.error ?? "알 수 없는 오류" };
  return { success: true, data: result as unknown as PublicSurveyData };
}

export interface AnswerInput {
  question_id: string;
  answer_text?: string | null;
  answer_score?: number | null;
}

// ── 결과 분석 (CRM 내부 — authenticated) ────────────────────

export interface ResponseAnswer {
  question_id: string;
  question_text: string;
  question_type: QuestionType;
  order_index: number;
  options: unknown | null;
  answer_text: string | null;
  answer_score: number | null;
}

export interface ResponseFollowup {
  id: string;
  status: FollowupStatus;
  notes: string | null;
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SurveyResponseDetail {
  id: string;
  submitted_at: string;
  respondent_phone: string | null;
  answers: ResponseAnswer[];
  followup: ResponseFollowup | null;
}

export interface SurveyResponseListResult {
  total: number;
  responses: SurveyResponseDetail[];
}

/** 설문 응답 목록 조회 (RPC) */
export async function getSurveyResponseList(
  templateId: string,
  limit = 200
): Promise<SurveyResponseListResult> {
  const { data, error } = await supabase.rpc(
    "get_survey_response_list" as "get_survey_results_summary",
    {
      p_survey_template_id: templateId,
      p_limit: limit,
    } as unknown as { p_survey_template_id: string }
  );
  if (error) throw error;
  const result = data as unknown as { success: boolean; error?: string; total?: number; responses?: SurveyResponseDetail[] };
  if (!result.success) throw new Error(result.error ?? "응답 목록 조회 실패");
  return { total: result.total ?? 0, responses: result.responses ?? [] };
}

// ── 후속관리 CRUD ─────────────────────────────────────────────

export interface CreateFollowupInput {
  response_id: string;
  branch_id: string;
  notes?: string;
  assigned_to?: string | null;
}

export async function createFollowup(input: CreateFollowupInput): Promise<ResponseFollowup> {
  const { data, error } = await supabase
    .from("survey_followups" as "members")
    .insert({
      response_id: input.response_id,
      branch_id: input.branch_id,
      notes: input.notes ?? null,
      assigned_to: input.assigned_to ?? null,
      status: "pending",
    })
    .select()
    .single();
  if (error) throw error;
  return data as unknown as ResponseFollowup;
}

export async function updateFollowup(
  id: string,
  body: Partial<Pick<ResponseFollowup, "status" | "notes" | "assigned_to" | "resolved_at">>
): Promise<ResponseFollowup> {
  const patch: Record<string, unknown> = { ...body };
  if (body.status === "resolved" && !body.resolved_at) {
    patch["resolved_at"] = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from("survey_followups" as "members")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as unknown as ResponseFollowup;
}

// ── 분석 헬퍼 함수 ────────────────────────────────────────────

/** 평점 질문 평균 계산 */
export function calcAvgScore(
  responses: SurveyResponseDetail[],
  questionType: QuestionType,
  maxScore = 10
): number | null {
  const scores: number[] = [];
  for (const r of responses) {
    for (const a of r.answers) {
      if (a.question_type === questionType && a.answer_score != null) {
        const opts = a.options as { max?: number } | null;
        const qMax = opts?.max ?? 5;
        if (qMax <= maxScore) scores.push(a.answer_score);
      }
    }
  }
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
}

/** 특정 question_text 키워드로 평균 계산 */
export function calcAvgByKeyword(
  responses: SurveyResponseDetail[],
  keyword: string
): number | null {
  const scores: number[] = [];
  for (const r of responses) {
    for (const a of r.answers) {
      if (a.question_text.includes(keyword) && a.answer_score != null) {
        scores.push(a.answer_score);
      }
    }
  }
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
}

/** NPS 계산 (0~10 척도 질문) */
export interface NpsResult {
  score: number;      // -100 ~ 100
  promoters: number;  // 9~10
  passives: number;   // 7~8
  detractors: number; // 0~6
  total: number;
}

export function calcNps(responses: SurveyResponseDetail[]): NpsResult | null {
  const scores: number[] = [];
  for (const r of responses) {
    for (const a of r.answers) {
      if (a.answer_score != null) {
        const opts = a.options as { max?: number } | null;
        const qMax = opts?.max ?? 5;
        if (qMax >= 10) scores.push(a.answer_score); // NPS 척도
      }
    }
  }
  if (scores.length === 0) return null;
  const promoters  = scores.filter((s) => s >= 9).length;
  const passives   = scores.filter((s) => s >= 7 && s <= 8).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const total = scores.length;
  const nps = Math.round(((promoters - detractors) / total) * 100);
  return { score: nps, promoters, passives, detractors, total };
}

/** 낮은 점수 응답 필터 (rating ≤ 2/5 또는 NPS ≤ 6) */
export function filterLowScoreResponses(
  responses: SurveyResponseDetail[],
  ratingThreshold = 2,
  npsThreshold = 6
): SurveyResponseDetail[] {
  return responses.filter((r) =>
    r.answers.some((a) => {
      if (a.answer_score == null) return false;
      const opts = a.options as { max?: number } | null;
      const qMax = opts?.max ?? 5;
      if (qMax >= 10) return a.answer_score <= npsThreshold;
      return a.answer_score <= ratingThreshold;
    })
  );
}

/** 주관식 텍스트 답변 추출 */
export function extractTextAnswers(
  responses: SurveyResponseDetail[]
): { responseId: string; submittedAt: string; text: string; questionText: string }[] {
  const result: { responseId: string; submittedAt: string; text: string; questionText: string }[] = [];
  for (const r of responses) {
    for (const a of r.answers) {
      if (a.question_type === "text" && a.answer_text?.trim()) {
        result.push({
          responseId: r.id,
          submittedAt: r.submitted_at,
          text: a.answer_text.trim(),
          questionText: a.question_text,
        });
      }
    }
  }
  return result;
}

/** 설문 응답 제출 (anon RPC) */
export async function submitPublicSurvey(
  qrSlug: string,
  answers: AnswerInput[],
  respondentPhone?: string
): Promise<{ success: boolean; response_id?: string; error?: string }> {
  const { data, error } = await supabase.rpc(
    "submit_survey_response" as "get_survey_results_summary",
    {
      p_qr_slug: qrSlug,
      p_answers: answers as unknown as string,
      p_member_id: null,
      p_respondent_phone: respondentPhone ?? null,
    } as unknown as { p_survey_template_id: string }
  );
  if (error) return { success: false, error: error.message };
  const result = data as unknown as { success: boolean; response_id?: string; error?: string };
  return result;
}

// ════════════════════════════════════════════════════════════
// 설문 발송 (초대) — Phase 5.5
// ════════════════════════════════════════════════════════════

const SURVEY_API_BASE = import.meta.env.VITE_API_BASE_URL as string;

/** Workers API 호출 (인증 헤더 포함) */
async function surveyApiPost<T>(path: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${SURVEY_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    success: boolean; data: T; message?: string; error?: { message?: string };
  };
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message ?? json.message ?? `HTTP ${res.status}`);
  }
  return json.data;
}

export type SurveyChannel =
  | "sms" | "kakao" | "both" | "kakao_sms_fallback"
  | "app_push" | "email" | "manual";

export type InviteStatus = "pending" | "sent" | "opened" | "responded" | "failed";

/** 채널별 한글 레이블 */
export const SURVEY_CHANNEL_LABELS: Record<SurveyChannel, string> = {
  sms: "문자(SMS/LMS)",
  kakao: "카카오 알림톡",
  both: "문자 + 알림톡",
  kakao_sms_fallback: "알림톡 우선 (실패 시 문자)",
  app_push: "앱 푸시 (링크 생성만)",
  email: "이메일 (링크 생성만)",
  manual: "직접 전달 (링크 생성만)",
};

/** 발송 기본 안내 문구 (#{회원명} #{지점명} #{설문링크} 치환 지원) */
export const DEFAULT_SURVEY_MESSAGE =
  "[#{지점명}] #{회원명}님, 안녕하세요!\n" +
  "더 나은 서비스를 위해 짧은 설문을 준비했습니다.\n" +
  "1분이면 충분해요. 참여해 주시면 큰 힘이 됩니다 🙏\n" +
  "▶ #{설문링크}";

export interface SurveySendParams {
  qr_code_id: string;
  member_ids: string[];
  channel: SurveyChannel;
  content: string;
  dry_run?: boolean;
}

export interface SurveySendLink {
  member_id: string;
  member_name: string;
  url: string;
  status: string;
  error?: string;
}

export interface SurveySendReport {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  links: SurveySendLink[];
}

export interface SurveySendDryRun {
  targets_count: number;
}

/** 설문 발송 (Workers API) — dry_run이면 대상 수만 반환 */
export async function sendSurvey(
  params: SurveySendParams
): Promise<SurveySendReport | SurveySendDryRun> {
  return surveyApiPost<SurveySendReport | SurveySendDryRun>(
    "/api/admin/surveys/send",
    params
  );
}

// ── 발송/응답 추적 통계 ───────────────────────────────────────

export interface SurveyInviteCounts {
  total: number;
  sent: number;
  opened: number;
  responded: number;
  failed: number;
}

export interface SurveyInviteRow {
  id: string;
  channel: SurveyChannel;
  status: InviteStatus;
  sent_at: string | null;
  opened_at: string | null;
  responded_at: string | null;
  error_message: string | null;
  created_at: string;
  member_name: string;
  recipient_phone: string | null;
}

export interface SurveyInviteStats {
  counts: SurveyInviteCounts;
  recent: SurveyInviteRow[];
}

/** 설문별 발송/열람/응답 통계 (RPC) */
export async function getSurveyInviteStats(templateId: string): Promise<SurveyInviteStats> {
  const { data, error } = await supabase.rpc(
    "get_survey_invite_stats" as "get_survey_results_summary",
    { p_survey_template_id: templateId } as unknown as { p_survey_template_id: string }
  );
  if (error) throw error;
  const result = data as unknown as {
    success: boolean; error?: string;
    counts?: SurveyInviteCounts; recent?: SurveyInviteRow[];
  };
  if (!result.success) throw new Error(result.error ?? "발송 통계 조회 실패");
  return {
    counts: result.counts ?? { total: 0, sent: 0, opened: 0, responded: 0, failed: 0 },
    recent: result.recent ?? [],
  };
}

// ── 공개 설문 — 개인 토큰(초대) 기반 ──────────────────────────

export interface InviteSurveyData extends PublicSurveyData {
  invite_token: string;
  member_name: string | null;
  already_responded: boolean;
}

/** 개인 토큰으로 설문 조회 (anon RPC) — 최초 열람 시 자동 기록 */
export async function getSurveyInvite(
  token: string
): Promise<{ success: true; data: InviteSurveyData } | { success: false; error: string }> {
  const { data, error } = await supabase.rpc(
    "get_survey_invite" as "get_survey_results_summary",
    { p_token: token } as unknown as { p_survey_template_id: string }
  );
  if (error) return { success: false, error: error.message };
  const result = data as unknown as { success: boolean; error?: string } & Partial<InviteSurveyData>;
  if (!result.success) return { success: false, error: result.error ?? "알 수 없는 오류" };
  return { success: true, data: result as unknown as InviteSurveyData };
}

/** 개인 토큰으로 설문 응답 제출 (anon RPC) — 회원에 자동 귀속 */
export async function submitSurveyViaInvite(
  token: string,
  answers: AnswerInput[]
): Promise<{ success: boolean; response_id?: string; error?: string }> {
  const { data, error } = await supabase.rpc(
    "submit_survey_via_invite" as "get_survey_results_summary",
    { p_token: token, p_answers: answers as unknown as string } as unknown as {
      p_survey_template_id: string;
    }
  );
  if (error) return { success: false, error: error.message };
  return data as unknown as { success: boolean; response_id?: string; error?: string };
}

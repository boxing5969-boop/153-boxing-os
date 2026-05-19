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
  const { data, error } = await supabase
    .from("survey_qr_codes" as "members")
    .insert({
      branch_id: input.branch_id,
      survey_template_id: input.survey_template_id,
      label: input.label ?? null,
      valid_until: input.valid_until ?? null,
      created_by: input.created_by ?? null,
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
  const env = import.meta.env as Record<string, string | undefined>;
  const base = env["VITE_SURVEY_BASE_URL"] ?? window.location.origin;
  return `${base}/survey/${slug}`;
}

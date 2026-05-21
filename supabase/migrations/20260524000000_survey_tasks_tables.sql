-- ============================================================
-- 3차: QR 설문 고도화 + 만족도 관리 + tasks
-- ============================================================
-- survey_forms/questions/qr_codes/responses 는 이미 존재(1세션 작업).
--   → 중복 생성하지 않고 기존 테이블에 컬럼만 추가.
-- 신규 테이블: tasks, survey_response_scores, survey_alerts.
-- ============================================================

-- ── 기존 survey_qr_codes: QR 유형 구분 ──────────────────────
ALTER TABLE public.survey_qr_codes
  ADD COLUMN IF NOT EXISTS qr_type text NOT NULL DEFAULT 'branch_common'
    CHECK (qr_type IN ('branch_common','class_session','coach',
                       'event','member_personal','after_workout','before_renewal')),
  ADD COLUMN IF NOT EXISTS target_ref_id uuid;   -- 수업/코치/회원 등 대상 ID

-- ── 기존 survey_questions: 지표 태깅 ────────────────────────
-- metric_key 로 질문을 'satisfaction'/'nps'/'recommend'/'renewal_intent' 등에 매핑.
ALTER TABLE public.survey_questions
  ADD COLUMN IF NOT EXISTS metric_key text;

-- ── 기존 survey_responses: 익명/개인정보 응답 구분 ──────────
ALTER TABLE public.survey_responses
  ADD COLUMN IF NOT EXISTS is_anonymous   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS respondent_name text;

-- ── tasks (지점 운영 할 일) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id     uuid REFERENCES public.brands(id)   ON DELETE SET NULL,
  branch_id    uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_id    uuid REFERENCES public.members(id)  ON DELETE SET NULL,
  assigned_to  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  task_type    text NOT NULL
               CHECK (task_type IN ('renewal','unpaid','no_show','low_satisfaction',
                                    'complaint','follow_up','other')),
  title        text NOT NULL,
  description  text,
  priority     text NOT NULL DEFAULT 'normal'
               CHECK (priority IN ('low','normal','high','urgent')),
  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','in_progress','done','cancelled')),
  due_date     date,
  source_table text,
  source_id    uuid,
  idempotency_key text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  deleted_at   timestamptz,
  created_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_branch_status
  ON public.tasks(branch_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_assigned
  ON public.tasks(assigned_to, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_due ON public.tasks(due_date) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_idem
  ON public.tasks(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ── survey_response_scores (응답별 지표 점수) ───────────────
CREATE TABLE IF NOT EXISTS public.survey_response_scores (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id        uuid NOT NULL REFERENCES public.survey_responses(id) ON DELETE CASCADE,
  survey_template_id uuid REFERENCES public.survey_templates(id) ON DELETE SET NULL,
  branch_id          uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  metric             text NOT NULL,            -- overall / satisfaction / nps / recommend / renewal_intent
  score              numeric(6,2) NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_response_scores
  ON public.survey_response_scores(response_id, metric);
CREATE INDEX IF NOT EXISTS idx_response_scores_branch
  ON public.survey_response_scores(branch_id, metric);

-- ── survey_alerts (불만/저점수 알림) ────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_alerts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id           uuid REFERENCES public.brands(id)   ON DELETE SET NULL,
  branch_id          uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  survey_template_id uuid REFERENCES public.survey_templates(id) ON DELETE SET NULL,
  response_id        uuid REFERENCES public.survey_responses(id) ON DELETE SET NULL,
  member_id          uuid REFERENCES public.members(id)  ON DELETE SET NULL,
  alert_type         text NOT NULL
                     CHECK (alert_type IN ('low_score','complaint_keyword','low_renewal_intent')),
  severity           text NOT NULL DEFAULT 'warning'
                     CHECK (severity IN ('info','warning','urgent')),
  keyword            text,
  message            text,
  status             text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','acknowledged','resolved','dismissed')),
  assigned_to        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_survey_alerts_branch
  ON public.survey_alerts(branch_id, status, created_at DESC);

-- ── 트리거: 테넌시 자동채움 + updated_at ────────────────────
CREATE OR REPLACE TRIGGER trg_tasks_fill BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();
CREATE OR REPLACE TRIGGER trg_survey_alerts_fill BEFORE INSERT ON public.survey_alerts
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();
CREATE OR REPLACE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_survey_alerts_updated_at BEFORE UPDATE ON public.survey_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.tasks                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_response_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_alerts          ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.tasks, public.survey_response_scores, public.survey_alerts TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.tasks, public.survey_alerts TO authenticated;
GRANT SELECT ON public.survey_response_scores TO authenticated;

-- tasks: 본사 전체 / 지점 관리자 자기 지점 / 담당자 본인 task
CREATE POLICY tasks_hq ON public.tasks FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY tasks_branch ON public.tasks FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());
CREATE POLICY tasks_assignee_select ON public.tasks FOR SELECT TO authenticated
  USING (assigned_to IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid()));

-- survey_alerts: 본사 전체 / 지점 관리자 자기 지점
CREATE POLICY survey_alerts_hq ON public.survey_alerts FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY survey_alerts_branch ON public.survey_alerts FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());

-- survey_response_scores: 조회만 (생성은 자동처리 함수)
CREATE POLICY response_scores_hq ON public.survey_response_scores FOR SELECT TO authenticated
  USING (is_hq_admin());
CREATE POLICY response_scores_branch ON public.survey_response_scores FOR SELECT TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id());

DO $$ BEGIN
  RAISE NOTICE 'tasks + survey_response_scores + survey_alerts + QR유형 완료';
END $$;

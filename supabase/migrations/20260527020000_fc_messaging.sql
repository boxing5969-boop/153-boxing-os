-- ============================================================
-- FC AI Care Center 1차-③: 메시징·연락 테이블
-- ============================================================
-- message_suggestions : 규칙/AI 기반 회원별 추천 메시지 (draft→approved→sent)
-- contact_logs        : FC 연락 기록 (append-only)
-- contact_outcomes    : 연락의 실제 성과 (재출석/재등록/PT구매 등)
-- ============================================================

-- ── message_suggestions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_suggestions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id          uuid REFERENCES public.brands(id)   ON DELETE SET NULL,
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_id         uuid NOT NULL REFERENCES public.members(id)  ON DELETE CASCADE,
  fc_task_id        uuid REFERENCES public.tasks(id)             ON DELETE CASCADE,
  template_id       uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  channel           text CHECK (channel IN ('kakao','sms','push')),
  generated_body    text,
  generation_reason text,
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','approved','sent','rejected')),
  message_job_id    uuid REFERENCES public.message_jobs(id) ON DELETE SET NULL,
  approved_by       uuid REFERENCES public.profiles(id)     ON DELETE SET NULL,
  approved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msg_suggestions_branch
  ON public.message_suggestions(branch_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_suggestions_task
  ON public.message_suggestions(fc_task_id);

-- ── contact_logs (append-only) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id      uuid REFERENCES public.brands(id)   ON DELETE SET NULL,
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES public.members(id)  ON DELETE CASCADE,
  fc_task_id    uuid REFERENCES public.tasks(id)    ON DELETE SET NULL,
  staff_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  channel       text CHECK (channel IN ('kakao','sms','push','call','visit')),
  message_body  text,
  contacted_at  timestamptz NOT NULL DEFAULT now(),
  result        text CHECK (result IN
                  ('sent','no_answer','replied','booked','visited','renewed','pt_purchased','failed')),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_logs_branch
  ON public.contact_logs(branch_id, contacted_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_logs_member
  ON public.contact_logs(member_id, contacted_at DESC);

-- ── contact_outcomes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_outcomes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id        uuid REFERENCES public.brands(id)   ON DELETE SET NULL,
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  contact_log_id  uuid NOT NULL REFERENCES public.contact_logs(id) ON DELETE CASCADE,
  member_id       uuid REFERENCES public.members(id)  ON DELETE SET NULL,
  outcome_type    text NOT NULL CHECK (outcome_type IN
                    ('re_attended','renewed','pt_purchased','referred_friend',
                     'complaint_resolved','unpaid_collected')),
  amount          numeric(12,2),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_outcomes_branch
  ON public.contact_outcomes(branch_id, occurred_at DESC);

-- ── 트리거 ──────────────────────────────────────────────────
CREATE OR REPLACE TRIGGER trg_msg_suggestions_fill BEFORE INSERT ON public.message_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();
CREATE OR REPLACE TRIGGER trg_msg_suggestions_updated_at BEFORE UPDATE ON public.message_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_contact_logs_fill BEFORE INSERT ON public.contact_logs
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();
CREATE OR REPLACE TRIGGER trg_contact_logs_append_only
  BEFORE UPDATE OR DELETE ON public.contact_logs
  FOR EACH ROW EXECUTE FUNCTION public.block_modify();
CREATE OR REPLACE TRIGGER trg_contact_outcomes_fill BEFORE INSERT ON public.contact_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.message_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_outcomes    ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.message_suggestions, public.contact_logs, public.contact_outcomes TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.message_suggestions, public.contact_outcomes TO authenticated;
GRANT SELECT, INSERT         ON public.contact_logs TO authenticated;

-- message_suggestions: 조회 + 쓰기(비-viewer·비-accountant전용)
CREATE POLICY msg_suggestions_read ON public.message_suggestions FOR SELECT TO authenticated
  USING (public.has_branch_access(branch_id) AND NOT public.is_accountant_only());
CREATE POLICY msg_suggestions_write ON public.message_suggestions FOR ALL TO authenticated
  USING (public.has_branch_access(branch_id)
         AND NOT public.is_viewer_only() AND NOT public.is_accountant_only())
  WITH CHECK (public.has_branch_access(branch_id)
         AND NOT public.is_viewer_only() AND NOT public.is_accountant_only());

-- contact_logs: 조회 + 삽입만 (수정/삭제는 append-only 트리거가 차단)
CREATE POLICY contact_logs_read ON public.contact_logs FOR SELECT TO authenticated
  USING (public.has_branch_access(branch_id) AND NOT public.is_accountant_only());
CREATE POLICY contact_logs_insert ON public.contact_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_branch_access(branch_id)
         AND NOT public.is_viewer_only() AND NOT public.is_accountant_only());

-- contact_outcomes: 조회 + 쓰기
CREATE POLICY contact_outcomes_read ON public.contact_outcomes FOR SELECT TO authenticated
  USING (public.has_branch_access(branch_id) AND NOT public.is_accountant_only());
CREATE POLICY contact_outcomes_write ON public.contact_outcomes FOR ALL TO authenticated
  USING (public.has_branch_access(branch_id)
         AND NOT public.is_viewer_only() AND NOT public.is_accountant_only())
  WITH CHECK (public.has_branch_access(branch_id)
         AND NOT public.is_viewer_only() AND NOT public.is_accountant_only());

DO $$ BEGIN
  RAISE NOTICE 'FC 1차-③: message_suggestions + contact_logs + contact_outcomes 완료';
END $$;

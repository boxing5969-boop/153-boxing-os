-- ============================================================
-- 멀티테넌트 1차-A: audit_logs(감사로그) + event_outbox(이벤트 아웃박스)
-- ============================================================
-- audit_logs   : 모든 중요 변경 기록. append-only(수정/삭제 불가).
-- event_outbox : 외부 호출 전 이벤트를 먼저 적재 → 워커가 처리.
-- 둘 다 신규 테이블 — 기존 기능 영향 없음.
-- 컬럼명은 기존 스키마 일관성을 위해 company_id 사용(= organization).
-- ============================================================

-- ── audit_logs (append-only) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        REFERENCES public.companies(id) ON DELETE SET NULL,
  brand_id      uuid        REFERENCES public.brands(id)    ON DELETE SET NULL,
  branch_id     uuid        REFERENCES public.branches(id)  ON DELETE SET NULL,
  actor_user_id uuid,                       -- auth.users.id (FK 미연결 — 계정 삭제돼도 로그 보존)
  actor_role    text,
  action        text        NOT NULL,        -- 예: member.create, membership.refund
  target_table  text,
  target_id     uuid,
  before_data   jsonb,
  after_data    jsonb,
  ip_address    text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_company  ON public.audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_branch   ON public.audit_logs(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target   ON public.audit_logs(target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor    ON public.audit_logs(actor_user_id, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.audit_logs TO service_role;       -- 기록은 service_role(워커)만
GRANT SELECT ON public.audit_logs TO authenticated;      -- authenticated 는 조회만

-- 조회: 본사는 전체, 지점 관리자는 자기 지점
CREATE POLICY audit_logs_hq_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (is_hq_admin());
CREATE POLICY audit_logs_branch_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id());
-- INSERT/UPDATE/DELETE 정책 없음 → authenticated 는 변경 불가(append-only).
-- 기록은 service_role(Workers auditLogger)이 수행.

-- ── event_outbox ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_outbox (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id       uuid        REFERENCES public.brands(id)    ON DELETE SET NULL,
  branch_id      uuid        REFERENCES public.branches(id)  ON DELETE SET NULL,
  event_type     text        NOT NULL,         -- 예: payment.succeeded, survey.low_score
  aggregate_type text,                         -- 예: membership, survey_response
  aggregate_id   uuid,
  payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','processing','completed','failed')),
  retry_count    int         NOT NULL DEFAULT 0,
  available_at   timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz,
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 워커가 처리 대기 이벤트를 빠르게 찾기 위한 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_event_outbox_due
  ON public.event_outbox(available_at)
  WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS idx_event_outbox_company
  ON public.event_outbox(company_id, created_at DESC);

ALTER TABLE public.event_outbox ENABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.event_outbox TO service_role;     -- 적재/처리는 service_role
GRANT SELECT ON public.event_outbox TO authenticated;

-- 조회: 본사 관리자만 (내부 인프라 테이블)
CREATE POLICY event_outbox_hq_select ON public.event_outbox
  FOR SELECT TO authenticated
  USING (is_hq_admin());

DO $$ BEGIN
  RAISE NOTICE 'audit_logs + event_outbox 테이블 생성 완료';
END $$;

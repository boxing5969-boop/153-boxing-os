-- ============================================================
-- Phase 20A-5: Integration Accounts + External API Logs + Webhooks
-- ============================================================
-- integration_accounts : Tenant 별 외부 서비스 연결 메타데이터.
--                        실제 시크릿은 Google Secret Manager / Wrangler secret 에 저장,
--                        DB 에는 secret_ref(외부 시크릿 식별자) 만 둔다.
-- external_api_logs    : 모든 외부 API 호출 결과 (Aligo/Payssam/KT 등).
-- webhook_events       : 수신한 모든 webhook 의 원본 + 처리 상태.
-- audit_logs           : 이미 존재 (20260522030000_audit_event_infra.sql) — 신규 생성 없음.
-- ============================================================

-- ── integration_accounts ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.integration_accounts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider        text        NOT NULL CHECK (provider IN ('payssam','aligo','kt_call_assistant')),
  account_label   text,
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','inactive','error')),
  config          jsonb,                            -- 비시크릿 메타데이터 (예: user_id, sender 등)
  secret_ref      text,                             -- Google Secret Manager 등 외부 ID. 평문 시크릿 저장 금지.
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integration_accounts_tenant   ON public.integration_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_integration_accounts_provider ON public.integration_accounts(provider);
CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_accounts_tenant_provider_label
  ON public.integration_accounts(tenant_id, provider, COALESCE(account_label, ''));

DROP TRIGGER IF EXISTS trg_integration_accounts_updated_at ON public.integration_accounts;
CREATE TRIGGER trg_integration_accounts_updated_at BEFORE UPDATE ON public.integration_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.integration_accounts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.integration_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.integration_accounts TO authenticated;

DROP POLICY IF EXISTS integration_accounts_tenant_rw ON public.integration_accounts;
CREATE POLICY integration_accounts_tenant_rw ON public.integration_accounts
  FOR ALL TO authenticated
  USING (has_tenant_role(tenant_id, ARRAY[
    'owner','hq_admin','super_admin','branch_owner','branch_manager'
  ]))
  WITH CHECK (has_tenant_role(tenant_id, ARRAY[
    'owner','hq_admin','super_admin','branch_owner','branch_manager'
  ]));

-- ── external_api_logs ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.external_api_logs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        REFERENCES public.companies(id) ON DELETE SET NULL,   -- 시스템 콜은 NULL 허용
  provider          text        NOT NULL,
  endpoint          text        NOT NULL,
  request_id        text,
  status            text        NOT NULL,
  request_payload   jsonb,
  response_payload  jsonb,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_external_api_logs_tenant_created   ON public.external_api_logs(tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_external_api_logs_provider_created ON public.external_api_logs(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_api_logs_request_id       ON public.external_api_logs(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_external_api_logs_status           ON public.external_api_logs(status);

ALTER TABLE public.external_api_logs ENABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.external_api_logs TO service_role;
GRANT SELECT ON public.external_api_logs TO authenticated;

-- HQ 는 전부 / Tenant 측은 자기 회사 + owner/관리자/회계 권한 필요
DROP POLICY IF EXISTS external_api_logs_select ON public.external_api_logs;
CREATE POLICY external_api_logs_select ON public.external_api_logs
  FOR SELECT TO authenticated
  USING (
    is_hq_admin()
    OR (tenant_id IS NOT NULL AND has_tenant_role(tenant_id, ARRAY[
      'owner','accountant','branch_owner','branch_manager'
    ]))
  );

-- ── webhook_events ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            text        NOT NULL,
  event_type          text,
  external_event_id   text,
  tenant_id           uuid        REFERENCES public.companies(id) ON DELETE SET NULL,
  payload             jsonb       NOT NULL,
  processed           boolean     NOT NULL DEFAULT false,
  processed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- 같은 외부 이벤트 중복 수신 방지
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_events_external
  ON public.webhook_events(provider, external_event_id) WHERE external_event_id IS NOT NULL;
-- 워커가 미처리 이벤트 찾기 위한 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_webhook_events_unprocessed
  ON public.webhook_events(provider, created_at) WHERE processed = false;
CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant
  ON public.webhook_events(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON public.webhook_events(created_at DESC);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.webhook_events TO service_role;
GRANT SELECT ON public.webhook_events TO authenticated;

-- HQ 만 조회 (운영 디버깅용) — Tenant 측엔 노출하지 않음 (PG payload 에 민감정보 포함 가능)
DROP POLICY IF EXISTS webhook_events_hq_select ON public.webhook_events;
CREATE POLICY webhook_events_hq_select ON public.webhook_events
  FOR SELECT TO authenticated USING (is_hq_admin());

-- ── audit_logs: 이미 존재 — 스키마 검증만 ────────────────────
-- 20260522030000_audit_event_infra.sql 에서:
--   audit_logs(id, company_id, brand_id, branch_id, actor_user_id, actor_role,
--              action, target_table, target_id, before_data, after_data,
--              ip_address, user_agent, created_at)
-- spec(#20) 요구 항목 모두 포함 (tenant_id ≡ company_id, metadata ≡ before/after_data).
-- 추가 변경 없음.

DO $$ BEGIN
  RAISE NOTICE 'Phase 20A-5: integration_accounts + external_api_logs + webhook_events 완료';
  RAISE NOTICE 'audit_logs 는 기존 20260522030000_audit_event_infra.sql 그대로 사용';
END $$;

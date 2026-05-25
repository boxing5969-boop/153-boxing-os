-- ============================================================
-- Phase 20A-4: B2B Messaging Layer
-- ============================================================
-- 신규 테이블:
--   leads            : 상담/문의 리드
--   message_senders  : 발신번호 등록 (Aligo 사전등록 의무)
--   message_consents : 회원/번호별 정보·마케팅 수신 동의
--   message_opt_outs : 수신거부 명단 (영구 차단)
--
-- 기존 테이블 확장 (호환 유지):
--   message_jobs     : provider, message_type, category, lead_id, sender_id,
--                      wallet_charge_krw, content, processed_at 추가
--                      status CHECK 에 'queued','refunded' 허용
--   message_logs     : tenant_id, recipient_phone, message_type,
--                      request_payload, response_payload, error_message 추가
--                      provider/provider_message_id 는 이미 존재
--   message_templates: tenant_id, category, message_type, is_active 추가
-- ============================================================

-- ── leads ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leads (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id   uuid        REFERENCES public.branches(id) ON DELETE SET NULL,
  name        text,
  phone       text        NOT NULL,
  source      text,
  status      text        NOT NULL DEFAULT 'new'
                          CHECK (status IN ('new','contacted','booked','joined','lost')),
  memo        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_created ON public.leads(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_branch         ON public.leads(branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_status         ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone          ON public.leads(tenant_id, phone);

DROP TRIGGER IF EXISTS trg_leads_updated_at ON public.leads;
CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.leads TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.leads TO authenticated;

DROP POLICY IF EXISTS leads_tenant_select ON public.leads;
CREATE POLICY leads_tenant_select ON public.leads
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS leads_tenant_modify ON public.leads;
CREATE POLICY leads_tenant_modify ON public.leads
  FOR ALL TO authenticated
  USING (has_tenant_role(tenant_id, ARRAY[
    'owner','hq_admin','super_admin','branch_owner','branch_manager','staff','coach'
  ]))
  WITH CHECK (has_tenant_role(tenant_id, ARRAY[
    'owner','hq_admin','super_admin','branch_owner','branch_manager','staff','coach'
  ]));

-- ── message_senders ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_senders (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id     uuid        REFERENCES public.branches(id) ON DELETE SET NULL,
  sender_number text        NOT NULL,
  provider      text        NOT NULL DEFAULT 'aligo' CHECK (provider IN ('aligo')),
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','rejected','disabled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_senders_tenant ON public.message_senders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_senders_branch ON public.message_senders(branch_id) WHERE branch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_senders_number
  ON public.message_senders(tenant_id, sender_number, provider);

DROP TRIGGER IF EXISTS trg_message_senders_updated_at ON public.message_senders;
CREATE TRIGGER trg_message_senders_updated_at BEFORE UPDATE ON public.message_senders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.message_senders ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.message_senders TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.message_senders TO authenticated;

DROP POLICY IF EXISTS message_senders_tenant_select ON public.message_senders;
CREATE POLICY message_senders_tenant_select ON public.message_senders
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS message_senders_tenant_modify ON public.message_senders;
CREATE POLICY message_senders_tenant_modify ON public.message_senders
  FOR ALL TO authenticated
  USING (has_tenant_role(tenant_id, ARRAY['owner','hq_admin','super_admin','branch_owner','branch_manager']))
  WITH CHECK (has_tenant_role(tenant_id, ARRAY['owner','hq_admin','super_admin','branch_owner','branch_manager']));

-- ── message_consents ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_consents (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  member_id              uuid        REFERENCES public.members(id) ON DELETE SET NULL,
  phone                  text        NOT NULL,
  informational_allowed  boolean     NOT NULL DEFAULT true,
  marketing_allowed      boolean     NOT NULL DEFAULT false,
  marketing_agreed_at    timestamptz,
  marketing_revoked_at   timestamptz,
  source                 text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_consents_tenant_phone
  ON public.message_consents(tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_message_consents_member ON public.message_consents(member_id) WHERE member_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_message_consents_updated_at ON public.message_consents;
CREATE TRIGGER trg_message_consents_updated_at BEFORE UPDATE ON public.message_consents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.message_consents ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.message_consents TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.message_consents TO authenticated;

DROP POLICY IF EXISTS message_consents_tenant_select ON public.message_consents;
CREATE POLICY message_consents_tenant_select ON public.message_consents
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS message_consents_tenant_modify ON public.message_consents;
CREATE POLICY message_consents_tenant_modify ON public.message_consents
  FOR ALL TO authenticated
  USING (has_tenant_role(tenant_id, ARRAY[
    'owner','hq_admin','super_admin','branch_owner','branch_manager','staff','coach'
  ]))
  WITH CHECK (has_tenant_role(tenant_id, ARRAY[
    'owner','hq_admin','super_admin','branch_owner','branch_manager','staff','coach'
  ]));

-- ── message_opt_outs ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_opt_outs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  phone         text        NOT NULL,
  reason        text,
  opted_out_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_opt_outs_tenant_phone
  ON public.message_opt_outs(tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_message_opt_outs_created ON public.message_opt_outs(tenant_id, created_at DESC);

ALTER TABLE public.message_opt_outs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.message_opt_outs TO service_role;
GRANT SELECT, INSERT ON public.message_opt_outs TO authenticated;

DROP POLICY IF EXISTS message_opt_outs_tenant_select ON public.message_opt_outs;
CREATE POLICY message_opt_outs_tenant_select ON public.message_opt_outs
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS message_opt_outs_tenant_insert ON public.message_opt_outs;
CREATE POLICY message_opt_outs_tenant_insert ON public.message_opt_outs
  FOR INSERT TO authenticated
  WITH CHECK (has_tenant_role(tenant_id, ARRAY[
    'owner','hq_admin','super_admin','branch_owner','branch_manager','staff','coach'
  ]));

-- ============================================================
-- 기존 테이블 확장 (호환 유지 — 기존 컬럼 손대지 않음)
-- ============================================================

-- ── message_jobs 확장 ────────────────────────────────────────
ALTER TABLE public.message_jobs
  ADD COLUMN IF NOT EXISTS provider          text,                                 -- 'aligo' 등
  ADD COLUMN IF NOT EXISTS message_type      text,                                 -- 'sms','lms','mms'
  ADD COLUMN IF NOT EXISTS category          text,                                 -- 'informational','marketing'
  ADD COLUMN IF NOT EXISTS lead_id           uuid REFERENCES public.leads(id)           ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sender_id         uuid REFERENCES public.message_senders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wallet_charge_krw integer,                              -- 발송 1건당 차감액
  ADD COLUMN IF NOT EXISTS content           text,                                 -- 최종 본문 (payload 보조)
  ADD COLUMN IF NOT EXISTS processed_at      timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_jobs_message_type_check') THEN
    ALTER TABLE public.message_jobs
      ADD CONSTRAINT message_jobs_message_type_check
      CHECK (message_type IS NULL OR message_type IN ('sms','lms','mms'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_jobs_category_check') THEN
    ALTER TABLE public.message_jobs
      ADD CONSTRAINT message_jobs_category_check
      CHECK (category IS NULL OR category IN ('informational','marketing'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_jobs_provider_check') THEN
    ALTER TABLE public.message_jobs
      ADD CONSTRAINT message_jobs_provider_check
      CHECK (provider IS NULL OR provider IN ('aligo','solapi','kt_call_assistant'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_jobs_wallet_charge_check') THEN
    ALTER TABLE public.message_jobs
      ADD CONSTRAINT message_jobs_wallet_charge_check
      CHECK (wallet_charge_krw IS NULL OR wallet_charge_krw >= 0);
  END IF;
END $$;

-- status CHECK 확장: 기존 'pending','processing','sent','failed','retry','cancelled'
--                  + 'queued','refunded' (B2B SaaS spec)
DO $$
DECLARE v_cn text;
BEGIN
  SELECT con.conname INTO v_cn
  FROM pg_constraint con
  JOIN pg_class cls ON cls.oid = con.conrelid
  WHERE cls.relname = 'message_jobs'
    AND cls.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%' AND pg_get_constraintdef(con.oid) ILIKE '%pending%';
  IF v_cn IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.message_jobs DROP CONSTRAINT %I', v_cn);
  END IF;
  ALTER TABLE public.message_jobs
    ADD CONSTRAINT message_jobs_status_check
    CHECK (status IN ('pending','queued','processing','sent','failed','retry','cancelled','refunded'));
END $$;

CREATE INDEX IF NOT EXISTS idx_message_jobs_lead ON public.message_jobs(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_jobs_sender ON public.message_jobs(sender_id) WHERE sender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_jobs_tenant_status
  ON public.message_jobs(company_id, status, scheduled_at);

-- ── message_logs 확장 ────────────────────────────────────────
ALTER TABLE public.message_logs
  ADD COLUMN IF NOT EXISTS tenant_id        uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS recipient_phone  text,
  ADD COLUMN IF NOT EXISTS message_type     text,
  ADD COLUMN IF NOT EXISTS status           text,
  ADD COLUMN IF NOT EXISTS request_payload  jsonb,
  ADD COLUMN IF NOT EXISTS response_payload jsonb,
  ADD COLUMN IF NOT EXISTS error_message    text;

-- 백필: message_jobs 통해 tenant_id 채움
UPDATE public.message_logs ml
SET tenant_id = j.company_id
FROM public.message_jobs j
WHERE ml.message_job_id = j.id AND ml.tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_message_logs_tenant_created
  ON public.message_logs(tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_logs_status ON public.message_logs(status) WHERE status IS NOT NULL;

-- ── message_templates 확장 ───────────────────────────────────
-- 기존: id, branch_id, name, content, channel, trigger_type, is_active, created_at, updated_at
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS tenant_id    uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS category     text,
  ADD COLUMN IF NOT EXISTS message_type text;

-- 백필: branch → company
UPDATE public.message_templates mt
SET tenant_id = b.company_id
FROM public.branches b
WHERE mt.branch_id = b.id AND mt.tenant_id IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_templates_category_check') THEN
    ALTER TABLE public.message_templates
      ADD CONSTRAINT message_templates_category_check
      CHECK (category IS NULL OR category IN ('informational','marketing'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_templates_message_type_check') THEN
    ALTER TABLE public.message_templates
      ADD CONSTRAINT message_templates_message_type_check
      CHECK (message_type IS NULL OR message_type IN ('sms','lms','mms'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_message_templates_tenant ON public.message_templates(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_templates_active ON public.message_templates(tenant_id, is_active) WHERE is_active = true;

DO $$ BEGIN
  RAISE NOTICE 'Phase 20A-4: leads + senders + consents + opt_outs + 기존 messaging 확장 완료';
END $$;

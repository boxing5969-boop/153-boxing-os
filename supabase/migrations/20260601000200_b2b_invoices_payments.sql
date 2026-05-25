-- ============================================================
-- Phase 20A-3: Service Invoices (PG/Payssam) + Payments
-- ============================================================
-- 기존 invoices 테이블은 멤버십 청구서용 — 손대지 않음.
-- service_invoices : 가맹점주가 PG(결제선생/Payssam)로 발행한 청구서.
-- payments         : PG 측 결제 결과 (raw_payload 포함, payment_events 와 별개).
--
-- 두 테이블 모두 tenant_id 필수. service_role 만 변경 가능 (PG 콜백 처리).
-- ============================================================

-- ── service_invoices ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_invoices (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id             uuid        REFERENCES public.branches(id) ON DELETE SET NULL,
  member_id             uuid        REFERENCES public.members(id)  ON DELETE SET NULL,
  provider              text        NOT NULL DEFAULT 'payssam' CHECK (provider IN ('payssam')),
  provider_invoice_id   text,
  amount_krw            integer     NOT NULL CHECK (amount_krw >= 0),
  wallet_charge_krw     integer     NOT NULL DEFAULT 80 CHECK (wallet_charge_krw >= 0),
  status                text        NOT NULL DEFAULT 'draft'
                                    CHECK (status IN ('draft','requested','sent','paid','failed','cancelled')),
  callback_received_at  timestamptz,
  idempotency_key       text,
  memo                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_invoices_tenant_created ON public.service_invoices(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_invoices_branch        ON public.service_invoices(branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_invoices_member        ON public.service_invoices(member_id) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_invoices_status        ON public.service_invoices(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_invoices_provider
  ON public.service_invoices(provider, provider_invoice_id) WHERE provider_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_invoices_idem
  ON public.service_invoices(idempotency_key) WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS trg_service_invoices_updated_at ON public.service_invoices;
CREATE TRIGGER trg_service_invoices_updated_at BEFORE UPDATE ON public.service_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── payments ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id          uuid        REFERENCES public.service_invoices(id) ON DELETE SET NULL,
  provider            text        NOT NULL DEFAULT 'payssam' CHECK (provider IN ('payssam')),
  provider_payment_id text,
  amount_krw          integer     NOT NULL CHECK (amount_krw >= 0),
  status              text        NOT NULL CHECK (status IN ('paid','cancelled','failed','refunded')),
  paid_at             timestamptz,
  raw_payload         jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_created ON public.payments(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_invoice        ON public.payments(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_status         ON public.payments(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider
  ON public.payments(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_payments_updated_at ON public.payments;
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.service_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments         ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.service_invoices, public.payments TO service_role;

-- authenticated: invoices 는 owner/매니저/회계가 CRUD, payments 는 SELECT 만
GRANT SELECT, INSERT, UPDATE ON public.service_invoices TO authenticated;
GRANT SELECT                  ON public.payments         TO authenticated;

DROP POLICY IF EXISTS service_invoices_tenant_rw ON public.service_invoices;
CREATE POLICY service_invoices_tenant_rw ON public.service_invoices
  FOR ALL TO authenticated
  USING (has_tenant_role(tenant_id, ARRAY[
    'owner','hq_admin','super_admin',
    'branch_owner','branch_manager','accountant'
  ]))
  WITH CHECK (has_tenant_role(tenant_id, ARRAY[
    'owner','hq_admin','super_admin',
    'branch_owner','branch_manager','accountant'
  ]));

DROP POLICY IF EXISTS payments_tenant_select ON public.payments;
CREATE POLICY payments_tenant_select ON public.payments
  FOR SELECT TO authenticated
  USING (has_tenant_role(tenant_id, ARRAY[
    'owner','hq_admin','super_admin',
    'branch_owner','branch_manager','accountant'
  ]));

DO $$ BEGIN
  RAISE NOTICE 'Phase 20A-3: service_invoices + payments + RLS 완료';
END $$;

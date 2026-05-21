-- ============================================================
-- 2차: 결제 도메인 — 이벤트 기반 구조
-- ============================================================
-- payment_requests : 결제 요청(링크 발송 대상)
-- payment_events   : PG 웹훅 등 결제 이벤트 (append-only)
-- invoices         : 청구서
-- refunds          : 환불
-- ledger_entries   : 정산 원장 (append-only)
-- 전부 신규 테이블 — 기존 memberships.payment_status 기반 로직과 독립.
-- 기존 결제/회원권 기능 영향 없음(병행 동작).
-- provider(PG/카카오) 연동 전 단계 — 컬럼만 두고 NULL 허용.
-- ============================================================

-- ── payment_requests ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id      uuid NOT NULL REFERENCES public.brands(id)    ON DELETE RESTRICT,
  branch_id     uuid NOT NULL REFERENCES public.branches(id)  ON DELETE CASCADE,
  member_id     uuid REFERENCES public.members(id)            ON DELETE SET NULL,
  membership_id uuid REFERENCES public.memberships(id)        ON DELETE SET NULL,
  purpose       text NOT NULL DEFAULT 'membership'
                CHECK (purpose IN ('new_membership','renewal','pt','product','other')),
  amount        numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency      text NOT NULL DEFAULT 'KRW',
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','sent','paid','failed','cancelled','expired')),
  provider      text,
  provider_ref  text,
  payment_link  text,
  idempotency_key text,
  due_at        timestamptz,
  paid_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_requests_branch ON public.payment_requests(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_member ON public.payment_requests(member_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON public.payment_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_idem
  ON public.payment_requests(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ── payment_events (append-only) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id           uuid REFERENCES public.brands(id)   ON DELETE SET NULL,
  branch_id          uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  payment_request_id uuid REFERENCES public.payment_requests(id) ON DELETE SET NULL,
  member_id          uuid REFERENCES public.members(id)  ON DELETE SET NULL,
  event_type         text NOT NULL
                     CHECK (event_type IN ('requested','link_sent','succeeded','failed','cancelled','refunded')),
  provider           text,
  provider_event_id  text,
  amount             numeric(12,2),
  currency           text NOT NULL DEFAULT 'KRW',
  raw_payload        jsonb,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_events_request ON public.payment_events(payment_request_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_payment_events_branch  ON public.payment_events(branch_id, occurred_at DESC);
-- 같은 PG 이벤트 중복 수신 방지
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_provider
  ON public.payment_events(provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

-- ── invoices ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id           uuid NOT NULL REFERENCES public.brands(id)    ON DELETE RESTRICT,
  branch_id          uuid NOT NULL REFERENCES public.branches(id)  ON DELETE CASCADE,
  member_id          uuid REFERENCES public.members(id)            ON DELETE SET NULL,
  membership_id      uuid REFERENCES public.memberships(id)        ON DELETE SET NULL,
  payment_request_id uuid REFERENCES public.payment_requests(id)   ON DELETE SET NULL,
  invoice_no         text,
  amount             numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount         numeric(12,2) NOT NULL DEFAULT 0,
  total_amount       numeric(12,2) NOT NULL DEFAULT 0,
  currency           text NOT NULL DEFAULT 'KRW',
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','issued','paid','void','refunded')),
  issued_at          timestamptz,
  paid_at            timestamptz,
  due_at             timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  created_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_branch ON public.invoices(branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_member ON public.invoices(member_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_no
  ON public.invoices(company_id, invoice_no) WHERE invoice_no IS NOT NULL;

-- ── refunds ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.refunds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id         uuid REFERENCES public.brands(id)    ON DELETE SET NULL,
  branch_id        uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_id        uuid REFERENCES public.members(id)   ON DELETE SET NULL,
  membership_id    uuid REFERENCES public.memberships(id) ON DELETE SET NULL,
  invoice_id       uuid REFERENCES public.invoices(id)  ON DELETE SET NULL,
  payment_event_id uuid REFERENCES public.payment_events(id) ON DELETE SET NULL,
  amount           numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency         text NOT NULL DEFAULT 'KRW',
  reason           text,
  status           text NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested','approved','processing','completed','rejected')),
  requested_at     timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_refunds_branch ON public.refunds(branch_id, created_at DESC);

-- ── ledger_entries (append-only 정산 원장) ──────────────────
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id    uuid REFERENCES public.brands(id)   ON DELETE SET NULL,
  branch_id   uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_id   uuid REFERENCES public.members(id)  ON DELETE SET NULL,
  entry_type  text NOT NULL CHECK (entry_type IN ('charge','payment','refund','adjustment')),
  direction   text NOT NULL CHECK (direction IN ('debit','credit')),
  amount      numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency    text NOT NULL DEFAULT 'KRW',
  ref_table   text,
  ref_id      uuid,
  description text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_branch ON public.ledger_entries(branch_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_ref    ON public.ledger_entries(ref_table, ref_id);

-- ── 테넌시 자동채움(branch_id → company/brand) ──────────────
CREATE OR REPLACE TRIGGER trg_payment_requests_fill BEFORE INSERT ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();
CREATE OR REPLACE TRIGGER trg_payment_events_fill   BEFORE INSERT ON public.payment_events
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();
CREATE OR REPLACE TRIGGER trg_invoices_fill         BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();
CREATE OR REPLACE TRIGGER trg_refunds_fill          BEFORE INSERT ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();
CREATE OR REPLACE TRIGGER trg_ledger_fill           BEFORE INSERT ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();

-- ── updated_at 트리거 (mutable 테이블) ──────────────────────
CREATE OR REPLACE TRIGGER trg_payment_requests_updated_at BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_refunds_updated_at BEFORE UPDATE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── append-only 강제 (payment_events / ledger_entries) ──────
CREATE OR REPLACE TRIGGER trg_payment_events_append_only
  BEFORE UPDATE OR DELETE ON public.payment_events
  FOR EACH ROW EXECUTE FUNCTION public.block_modify();
CREATE OR REPLACE TRIGGER trg_ledger_append_only
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.block_modify();

-- ── 결제 이벤트 → audit_logs + event_outbox 자동 적재 ───────
CREATE OR REPLACE FUNCTION public.on_payment_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_logs
    (company_id, brand_id, branch_id, action, target_table, target_id, after_data)
  VALUES
    (NEW.company_id, NEW.brand_id, NEW.branch_id,
     'payment.' || NEW.event_type, 'payment_events', NEW.id, to_jsonb(NEW));

  INSERT INTO public.event_outbox
    (company_id, brand_id, branch_id, event_type, aggregate_type, aggregate_id, payload)
  VALUES
    (NEW.company_id, NEW.brand_id, NEW.branch_id,
     'payment.' || NEW.event_type, 'payment_event', NEW.id, to_jsonb(NEW));

  RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER trg_payment_event_fanout
  AFTER INSERT ON public.payment_events
  FOR EACH ROW EXECUTE FUNCTION public.on_payment_event();

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries   ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.payment_requests, public.invoices, public.refunds TO service_role;
GRANT ALL ON public.payment_events, public.ledger_entries TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.payment_requests, public.invoices, public.refunds TO authenticated;
GRANT SELECT ON public.payment_events, public.ledger_entries TO authenticated;

-- mutable 3종: 본사 전체 / 지점 관리자 자기 지점
CREATE POLICY payment_requests_hq  ON public.payment_requests FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY payment_requests_brc ON public.payment_requests FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());

CREATE POLICY invoices_hq  ON public.invoices FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY invoices_brc ON public.invoices FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());

CREATE POLICY refunds_hq  ON public.refunds FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY refunds_brc ON public.refunds FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());

-- append-only 2종: 조회만 (적재는 service_role)
CREATE POLICY payment_events_hq  ON public.payment_events FOR SELECT TO authenticated
  USING (is_hq_admin());
CREATE POLICY payment_events_brc ON public.payment_events FOR SELECT TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id());

CREATE POLICY ledger_hq  ON public.ledger_entries FOR SELECT TO authenticated
  USING (is_hq_admin());
CREATE POLICY ledger_brc ON public.ledger_entries FOR SELECT TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id());

DO $$ BEGIN
  RAISE NOTICE '결제 도메인 5개 테이블 + 이벤트 팬아웃 트리거 완료';
END $$;

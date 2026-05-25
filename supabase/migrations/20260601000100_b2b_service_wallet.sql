-- ============================================================
-- Phase 20A-2: Service Wallet (선불 충전식 지갑) + 단가 카탈로그
-- ============================================================
-- service_wallets               : tenant 별 1개, balance 캐시
-- service_wallet_transactions   : append-only 원장 (sum = balance 검증 가능)
-- usage_price_rules             : 글로벌 단가 카탈로그 (HQ 본사 단독 관리)
-- debit_service_wallet()        : 행잠금 + 멱등 + 음수잔액 방지
-- refund_service_wallet()       : 멱등 환불
-- get_active_usage_price()      : 활성 단가 조회
--
-- 보안 원칙:
--   • 브라우저(authenticated)는 SELECT 만 가능, 쓰기는 service_role 만.
--   • debit/refund RPC 는 service_role 전용 — 브라우저 직접 호출 차단.
--   • transactions 는 append-only 트리거(block_modify) 적용.
-- ============================================================

-- ── usage_price_rules (글로벌) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage_price_rules (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_type  text        NOT NULL,
  cost_krw    integer     NOT NULL CHECK (cost_krw   >= 0),  -- 본사 원가
  charge_krw  integer     NOT NULL CHECK (charge_krw >= 0),  -- 가맹점 청구가
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 활성 단가는 usage_type 당 1개만
CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_price_rules_active_type
  ON public.usage_price_rules(usage_type) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_usage_price_rules_type ON public.usage_price_rules(usage_type);

DROP TRIGGER IF EXISTS trg_usage_price_rules_updated_at ON public.usage_price_rules;
CREATE TRIGGER trg_usage_price_rules_updated_at BEFORE UPDATE ON public.usage_price_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.usage_price_rules ENABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.usage_price_rules TO service_role;
GRANT SELECT ON public.usage_price_rules TO authenticated;
DROP POLICY IF EXISTS usage_price_rules_select ON public.usage_price_rules;
CREATE POLICY usage_price_rules_select ON public.usage_price_rules
  FOR SELECT TO authenticated USING (is_active = true);

-- 기본 단가 시드 (이미 활성 단가 있으면 skip)
INSERT INTO public.usage_price_rules (usage_type, cost_krw, charge_krw, is_active)
SELECT v.usage_type, v.cost_krw, v.charge_krw, true
FROM (VALUES
  ('payssam_invoice',  55,  80),
  ('sms',               9,  12),
  ('lms',              26,  39),
  ('mms',              60,  90)
) AS v(usage_type, cost_krw, charge_krw)
WHERE NOT EXISTS (
  SELECT 1 FROM public.usage_price_rules r
  WHERE r.usage_type = v.usage_type AND r.is_active = true
);

-- ── service_wallets ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_wallets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  balance_krw  integer     NOT NULL DEFAULT 0 CHECK (balance_krw >= 0),
  status       text        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','suspended')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_wallets_tenant ON public.service_wallets(tenant_id);

DROP TRIGGER IF EXISTS trg_service_wallets_updated_at ON public.service_wallets;
CREATE TRIGGER trg_service_wallets_updated_at BEFORE UPDATE ON public.service_wallets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 백필: 모든 companies 에 wallet row 생성 (잔액 0)
INSERT INTO public.service_wallets (tenant_id, balance_krw, status)
SELECT c.id, 0, 'active'
FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.service_wallets w WHERE w.tenant_id = c.id);

-- ── service_wallet_transactions (append-only) ────────────────
-- amount_krw 부호 규약:
--   charge/refund  → 양수
--   debit          → 음수
--   adjustment     → ± 자유
CREATE TABLE IF NOT EXISTS public.service_wallet_transactions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES public.companies(id)       ON DELETE CASCADE,
  wallet_id          uuid        NOT NULL REFERENCES public.service_wallets(id) ON DELETE CASCADE,
  type               text        NOT NULL CHECK (type IN ('charge','debit','refund','adjustment')),
  usage_type         text,                                                       -- payssam_invoice/sms/lms/mms/alimtalk/kt_call_followup
  amount_krw         integer     NOT NULL,                                       -- 부호 = 방향
  balance_after_krw  integer     NOT NULL CHECK (balance_after_krw >= 0),
  external_ref       text,                                                       -- 외부 결제/발송 ID
  idempotency_key    text,
  memo               text,
  created_by         uuid,                                                       -- auth.users.id (FK 미연결: service_role 자체 호출 가능)
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_swt_tenant_created ON public.service_wallet_transactions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swt_wallet_created ON public.service_wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swt_usage_type ON public.service_wallet_transactions(usage_type) WHERE usage_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_swt_type ON public.service_wallet_transactions(type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_swt_idempotency
  ON public.service_wallet_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- append-only: UPDATE/DELETE 차단 (감사 무결성)
DROP TRIGGER IF EXISTS trg_swt_append_only ON public.service_wallet_transactions;
CREATE TRIGGER trg_swt_append_only
  BEFORE UPDATE OR DELETE ON public.service_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.block_modify();

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.service_wallets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_wallet_transactions ENABLE ROW LEVEL SECURITY;

GRANT ALL    ON public.service_wallets, public.service_wallet_transactions TO service_role;
GRANT SELECT ON public.service_wallets             TO authenticated;
GRANT SELECT ON public.service_wallet_transactions TO authenticated;

-- wallets: 같은 tenant 의 active member 면 잔액 조회
DROP POLICY IF EXISTS service_wallets_tenant_select ON public.service_wallets;
CREATE POLICY service_wallets_tenant_select ON public.service_wallets
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));

-- transactions: 같은 tenant 의 owner/관리자/회계만 조회
DROP POLICY IF EXISTS service_wallet_transactions_tenant_select ON public.service_wallet_transactions;
CREATE POLICY service_wallet_transactions_tenant_select ON public.service_wallet_transactions
  FOR SELECT TO authenticated
  USING (has_tenant_role(tenant_id, ARRAY[
    'owner','hq_admin','super_admin','accountant',
    'branch_owner','branch_manager'
  ]));

-- ============================================================
-- RPC: get_active_usage_price
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_active_usage_price(p_usage_type text)
RETURNS TABLE(usage_type text, cost_krw integer, charge_krw integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT usage_type, cost_krw, charge_krw
  FROM public.usage_price_rules
  WHERE usage_type = p_usage_type AND is_active = true
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_active_usage_price(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_usage_price(text) TO authenticated, service_role;

-- ============================================================
-- RPC: debit_service_wallet (행잠금 + 멱등 + 음수잔액 방지)
-- ============================================================
CREATE OR REPLACE FUNCTION public.debit_service_wallet(
  p_tenant_id       uuid,
  p_usage_type      text,
  p_amount_krw      integer,
  p_idempotency_key text DEFAULT NULL,
  p_memo            text DEFAULT NULL
)
RETURNS public.service_wallet_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet   public.service_wallets%ROWTYPE;
  v_existing public.service_wallet_transactions%ROWTYPE;
  v_new      public.service_wallet_transactions%ROWTYPE;
BEGIN
  IF p_amount_krw IS NULL OR p_amount_krw <= 0 THEN
    RAISE EXCEPTION 'amount_krw must be positive (got %)', p_amount_krw USING ERRCODE = '22023';
  END IF;
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_usage_type IS NULL OR length(trim(p_usage_type)) = 0 THEN
    RAISE EXCEPTION 'usage_type is required' USING ERRCODE = '22023';
  END IF;

  -- 멱등: 같은 idempotency_key 가 이미 있으면 그 row 반환
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.service_wallet_transactions
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- 행 잠금 — 동시 차감 방지
  SELECT * INTO v_wallet FROM public.service_wallets
  WHERE tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet not found for tenant %', p_tenant_id USING ERRCODE = 'P0002';
  END IF;
  IF v_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'wallet status is %', v_wallet.status USING ERRCODE = 'P0001';
  END IF;
  IF v_wallet.balance_krw < p_amount_krw THEN
    RAISE EXCEPTION 'insufficient balance: have % need %', v_wallet.balance_krw, p_amount_krw
      USING ERRCODE = 'P0001', HINT = '잔액 부족 — 충전 필요';
  END IF;

  -- 잔액 차감
  UPDATE public.service_wallets
  SET balance_krw = balance_krw - p_amount_krw, updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  -- 원장 적재 (amount_krw 음수)
  INSERT INTO public.service_wallet_transactions
    (tenant_id, wallet_id, type, usage_type, amount_krw, balance_after_krw, idempotency_key, memo, created_by)
  VALUES
    (p_tenant_id, v_wallet.id, 'debit', p_usage_type, -p_amount_krw, v_wallet.balance_krw,
     p_idempotency_key, p_memo, auth.uid())
  RETURNING * INTO v_new;

  RETURN v_new;
END $$;

REVOKE ALL ON FUNCTION public.debit_service_wallet(uuid,text,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_service_wallet(uuid,text,integer,text,text) TO service_role;

-- ============================================================
-- RPC: refund_service_wallet (멱등 환불)
-- ============================================================
CREATE OR REPLACE FUNCTION public.refund_service_wallet(
  p_tenant_id       uuid,
  p_amount_krw      integer,
  p_idempotency_key text DEFAULT NULL,
  p_memo            text DEFAULT NULL
)
RETURNS public.service_wallet_transactions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_wallet   public.service_wallets%ROWTYPE;
  v_existing public.service_wallet_transactions%ROWTYPE;
  v_new      public.service_wallet_transactions%ROWTYPE;
BEGIN
  IF p_amount_krw IS NULL OR p_amount_krw <= 0 THEN
    RAISE EXCEPTION 'amount_krw must be positive' USING ERRCODE = '22023';
  END IF;
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required' USING ERRCODE = '22023';
  END IF;

  -- 멱등
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.service_wallet_transactions
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT * INTO v_wallet FROM public.service_wallets
  WHERE tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet not found for tenant %', p_tenant_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.service_wallets
  SET balance_krw = balance_krw + p_amount_krw, updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.service_wallet_transactions
    (tenant_id, wallet_id, type, amount_krw, balance_after_krw, idempotency_key, memo, created_by)
  VALUES
    (p_tenant_id, v_wallet.id, 'refund', p_amount_krw, v_wallet.balance_krw,
     p_idempotency_key, p_memo, auth.uid())
  RETURNING * INTO v_new;

  RETURN v_new;
END $$;

REVOKE ALL ON FUNCTION public.refund_service_wallet(uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_service_wallet(uuid,integer,text,text) TO service_role;

DO $$ BEGIN
  RAISE NOTICE 'Phase 20A-2: wallet + ledger + price catalog + RPC 3종 완료';
END $$;

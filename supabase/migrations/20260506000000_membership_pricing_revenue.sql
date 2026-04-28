-- Phase 18 마이그레이션: 이용권 가격 + 매출 집계 RPC

-- ============================================================
-- 1) memberships 가격 컬럼 추가 (NULL 가능 — 기존 row 호환)
-- ============================================================
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'KRW';

ALTER TABLE memberships
  ADD CONSTRAINT memberships_price_nonneg CHECK (price IS NULL OR price >= 0);

COMMENT ON COLUMN memberships.price IS '이용권 가격 (회계용). NULL = 시스템 도입 전 데이터';
COMMENT ON COLUMN memberships.currency IS 'ISO 4217 통화 코드. 기본 KRW';

-- ============================================================
-- 2) get_revenue_summary — 기간 합계 (paid/partial/unpaid/refunded × total/count)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_revenue_summary(
  _from date,
  _to date,
  _branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_hq boolean := public.is_hq_admin();
  caller_branch uuid;
  effective_branch uuid := _branch_id;
BEGIN
  IF NOT is_hq THEN
    caller_branch := public.current_branch_id();
    IF caller_branch IS NULL THEN
      RAISE EXCEPTION 'Permission denied';
    END IF;
    -- 비-hq 는 자기 지점만 강제
    effective_branch := caller_branch;
  END IF;

  IF _to < _from THEN
    RAISE EXCEPTION 'to must be >= from';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'from', _from,
      'to', _to,
      'branch_id', effective_branch,
      'paid_total', coalesce(sum(price) FILTER (WHERE payment_status = 'paid'), 0),
      'partial_total', coalesce(sum(price) FILTER (WHERE payment_status = 'partial'), 0),
      'unpaid_total', coalesce(sum(price) FILTER (WHERE payment_status = 'unpaid'), 0),
      'refunded_total', coalesce(sum(price) FILTER (WHERE payment_status = 'refunded'), 0),
      'paid_count', count(*) FILTER (WHERE payment_status = 'paid'),
      'partial_count', count(*) FILTER (WHERE payment_status = 'partial'),
      'unpaid_count', count(*) FILTER (WHERE payment_status = 'unpaid'),
      'refunded_count', count(*) FILTER (WHERE payment_status = 'refunded'),
      'total_count', count(*)
    )
    FROM memberships
    WHERE created_at::date >= _from
      AND created_at::date <= _to
      AND (effective_branch IS NULL OR branch_id = effective_branch)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_revenue_summary(date, date, uuid) TO authenticated;

-- ============================================================
-- 3) get_revenue_daily — 일별 분해 (CSV 출력 용)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_revenue_daily(
  _from date,
  _to date,
  _branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  day date,
  paid_total numeric,
  partial_total numeric,
  unpaid_total numeric,
  refunded_total numeric,
  paid_count bigint,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_hq boolean := public.is_hq_admin();
  caller_branch uuid;
  effective_branch uuid := _branch_id;
BEGIN
  IF NOT is_hq THEN
    caller_branch := public.current_branch_id();
    IF caller_branch IS NULL THEN
      RETURN;
    END IF;
    effective_branch := caller_branch;
  END IF;

  IF _to < _from THEN
    RAISE EXCEPTION 'to must be >= from';
  END IF;

  RETURN QUERY
    SELECT
      m.created_at::date AS day,
      coalesce(sum(m.price) FILTER (WHERE m.payment_status = 'paid'), 0) AS paid_total,
      coalesce(sum(m.price) FILTER (WHERE m.payment_status = 'partial'), 0) AS partial_total,
      coalesce(sum(m.price) FILTER (WHERE m.payment_status = 'unpaid'), 0) AS unpaid_total,
      coalesce(sum(m.price) FILTER (WHERE m.payment_status = 'refunded'), 0) AS refunded_total,
      count(*) FILTER (WHERE m.payment_status = 'paid') AS paid_count,
      count(*) AS total_count
    FROM memberships m
    WHERE m.created_at::date >= _from
      AND m.created_at::date <= _to
      AND (effective_branch IS NULL OR m.branch_id = effective_branch)
    GROUP BY m.created_at::date
    ORDER BY m.created_at::date;
END $$;

GRANT EXECUTE ON FUNCTION public.get_revenue_daily(date, date, uuid) TO authenticated;

-- ============================================================
-- 4) get_outstanding_payments — 미납·부분결제 회원 리스트
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_outstanding_payments(_branch_id uuid DEFAULT NULL)
RETURNS TABLE (
  membership_id uuid,
  member_id uuid,
  member_name text,
  branch_id uuid,
  plan_name text,
  start_date date,
  end_date date,
  payment_status payment_status,
  price numeric,
  days_since_start int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_hq boolean := public.is_hq_admin();
  caller_branch uuid;
  effective_branch uuid := _branch_id;
BEGIN
  IF NOT is_hq THEN
    caller_branch := public.current_branch_id();
    IF caller_branch IS NULL THEN
      RETURN;
    END IF;
    effective_branch := caller_branch;
  END IF;

  RETURN QUERY
    SELECT
      ms.id,
      ms.member_id,
      m.name::text,
      ms.branch_id,
      ms.plan_name,
      ms.start_date,
      ms.end_date,
      ms.payment_status,
      ms.price,
      GREATEST(0, (CURRENT_DATE - ms.start_date))::int
    FROM memberships ms
    JOIN members m ON m.id = ms.member_id
    WHERE ms.payment_status IN ('unpaid', 'partial')
      AND ms.status IN ('active', 'expired')
      AND (effective_branch IS NULL OR ms.branch_id = effective_branch)
    ORDER BY ms.start_date ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.get_outstanding_payments(uuid) TO authenticated;

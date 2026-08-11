-- 매출 집계를 '매출 내역(sales_entries)' 하나로 통일한다.
--
-- 문제: get_revenue_summary / get_revenue_daily 가 memberships.price 를 합산했는데,
--   실제로 그 값이 채워진 이용권은 602건 중 **1건**뿐이었다(54만원).
--   반면 실제 매출은 sales_entries 에 7억 1,819만원이 쌓여 있다
--   (브로제이 연동 + 엑셀 업로드 + 화면 직접 등록이 모두 여기로 들어온다).
--   그래서 홈 '매출 현황'·재무·미수금 화면이 사실상 빈 숫자를 보여줬고,
--   같은 페이지의 '매출 분석' 탭과 1,300배 차이가 났다.
--
-- 해결 — 용어를 나눈다:
--   · 받은 돈(paid_total)     = sales_entries 양수 합   ← 연동·엑셀·직접입력 전부 포함
--   · 환불(refunded_total)    = sales_entries 음수 합의 절대값
--   · 못 받은 돈(unpaid_total) = memberships 미납 이용권 (매출 원장에는 없는 개념이라 유지)
--   'partial' 은 매출 원장에 대응 개념이 없어 0 으로 둔다(화면 미사용).
--
-- 권한은 그대로 — 본사는 전 지점, 그 외는 자기 지점만(SECURITY DEFINER + current_branch_id).
--
-- 함께 바뀐 것:
--   · 홈 '이번달 결제 완료' → '이번달 받은 돈' (+ 환불 표시)
--   · 재무 '이번달 매출 (이용권 결제)' → '이번달 받은 돈'
--   · 미수금·내역 '총 매출' → '받은 돈'
--   · 이용권 등록 창에 '이 금액을 매출로도 기록' 선택 + 중복 경고
--     (GET /api/reports/sales/check-duplicate)

CREATE OR REPLACE FUNCTION public.get_revenue_summary(_from date, _to date, _branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_hq boolean := public.is_hq_admin();
  caller_branch uuid;
  effective_branch uuid := _branch_id;
  v_paid numeric := 0;
  v_refunded numeric := 0;
  v_paid_cnt bigint := 0;
  v_total_cnt bigint := 0;
  v_unpaid numeric := 0;
  v_unpaid_cnt bigint := 0;
BEGIN
  IF NOT is_hq THEN
    caller_branch := public.current_branch_id();
    IF caller_branch IS NULL THEN
      RAISE EXCEPTION 'Permission denied';
    END IF;
    effective_branch := caller_branch;
  END IF;

  IF _to < _from THEN
    RAISE EXCEPTION 'to must be >= from';
  END IF;

  -- 받은 돈 · 환불 — 매출 원장 기준
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0),
    COALESCE(SUM(-amount) FILTER (WHERE amount < 0), 0),
    COUNT(*) FILTER (WHERE amount > 0),
    COUNT(*)
  INTO v_paid, v_refunded, v_paid_cnt, v_total_cnt
  FROM sales_entries
  WHERE sale_date >= _from AND sale_date <= _to
    AND (effective_branch IS NULL OR branch_id = effective_branch);

  -- 못 받은 돈 — 이용권 기준(미납)
  SELECT COALESCE(SUM(price), 0), COUNT(*)
  INTO v_unpaid, v_unpaid_cnt
  FROM memberships
  WHERE created_at::date >= _from AND created_at::date <= _to
    AND payment_status = 'unpaid'
    AND (effective_branch IS NULL OR branch_id = effective_branch);

  RETURN jsonb_build_object(
    'from', _from,
    'to', _to,
    'branch_id', effective_branch,
    'paid_total', v_paid,
    'partial_total', 0,
    'unpaid_total', v_unpaid,
    'refunded_total', v_refunded,
    'paid_count', v_paid_cnt,
    'partial_count', 0,
    'unpaid_count', v_unpaid_cnt,
    'refunded_count', (SELECT COUNT(*) FROM sales_entries
                        WHERE sale_date >= _from AND sale_date <= _to AND amount < 0
                          AND (effective_branch IS NULL OR branch_id = effective_branch)),
    'total_count', v_total_cnt,
    'source', 'sales_entries'
  );
END $function$;

CREATE OR REPLACE FUNCTION public.get_revenue_daily(_from date, _to date, _branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(day date, paid_total numeric, partial_total numeric, unpaid_total numeric, refunded_total numeric, paid_count bigint, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      s.sale_date AS day,
      COALESCE(SUM(s.amount) FILTER (WHERE s.amount > 0), 0)::numeric AS paid_total,
      0::numeric AS partial_total,
      0::numeric AS unpaid_total,
      COALESCE(SUM(-s.amount) FILTER (WHERE s.amount < 0), 0)::numeric AS refunded_total,
      COUNT(*) FILTER (WHERE s.amount > 0) AS paid_count,
      COUNT(*) AS total_count
    FROM sales_entries s
    WHERE s.sale_date >= _from AND s.sale_date <= _to
      AND (effective_branch IS NULL OR s.branch_id = effective_branch)
    GROUP BY s.sale_date
    ORDER BY s.sale_date;
END $function$;

-- ── 롤백 ────────────────────────────────────────────────────
-- 두 함수를 memberships.price 기준(20260614~ 원본)으로 CREATE OR REPLACE 하면 된다.
-- 다만 그 상태는 실제 매출의 0.08% 만 보여주므로 되돌릴 이유가 없다.

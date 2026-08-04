-- 매출 장부 단일화: 일일 리포트의 매출 숫자를 '매출 내역(sales_entries)' 에서 다시 계산한다.
--
-- 문제: 브로제이 동기화는 sales_entries + daily_reports 를 둘 다 갱신하는데
--   수동 엑셀 업로드는 sales_entries 만 채웠다. 게다가 브로제이 동기화는
--   자기(source='broj') 분만 합산해 덮어써서, 같은 날 수동 업로드분이 리포트에서 사라졌다.
--   실제로 선릉역점 2026-07-02 에 79만원이 매출 분석에만 있고 일일 리포트엔 없었다.
--   관장님 화면 두 곳의 숫자가 달라 어느 쪽을 믿을지 알 수 없는 상태였다.
--
-- 해결: 어느 경로로 들어왔든 sales_entries 전체를 그 날의 정답으로 삼아 재계산한다.
--   출석·문의·가입 등 관장님이 손으로 적는 항목은 건드리지 않는다.
--
-- 호출 지점: workers/api/src/services/brojSync.ts (브로제이 동기화 후)
--            workers/api/src/routes/dailyReports.ts POST /sales/import (엑셀 업로드 후)
--
-- 2026-08-04 보강(2): PT 를 상품명으로도 가른다. category 에는 'PT' 가 절대 안 들어와
--   revenue_pt 가 구조적으로 항상 0 이었고(화면엔 PT 칸이 있는데), 실제 PT 결제는
--   '수강권 + 퍼스널 트레이닝 20회권' 형태로 수강권에 섞여 있었다.
--   sales-summary 라우트도 같은 기준으로 맞췄다(숫자 단일 출처).
--
-- 2026-08-04 보강: 합계를 bigint 로 계산한다. int 였을 때는 금액 오타(0 을 더 누름) 한 건이
--   그 날짜 재계산을 통째로 실패시켜, 이후 등록·삭제까지 리포트에 반영되지 않았다.
--   입력 상한(1억)은 워커 zod(salesCreateSchema)에서 따로 막는다.
--
-- 검증(2026-08-04): 선릉역점 211일 재계산 → 리포트 총매출 = 내역 총매출 271,775,500 (차이 0건).
--   잠실점에서 수기값(문의7·오전출석13·시설메모) 심어놓고 재계산 → 그대로 보존, 다른 날 변경 0건.

CREATE OR REPLACE FUNCTION public.recalc_daily_revenue(
  _branch_id uuid, _from date, _to date
) RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE affected int := 0;
BEGIN
  IF _branch_id IS NULL OR _from IS NULL OR _to IS NULL THEN
    RAISE EXCEPTION '지점과 기간이 필요합니다';
  END IF;
  IF _to < _from THEN
    RAISE EXCEPTION '기간이 거꾸로입니다';
  END IF;
  IF _to - _from > 800 THEN
    RAISE EXCEPTION '한 번에 다시 계산할 수 있는 기간은 800일까지입니다';
  END IF;

  WITH agg AS (
    SELECT
      s.sale_date AS d,
      -- PT: 분류 또는 상품명에 PT 표기가 있으면 (브로제이는 '수강권' + '퍼스널 트레이닝…' 으로 넣는다)
      COALESCE(SUM(s.amount) FILTER (WHERE s.amount > 0
        AND (s.category || ' ' || COALESCE(s.product,'')) ~ 'PT|피티|퍼스널|개인'), 0)::bigint AS pt,
      COALESCE(SUM(s.amount) FILTER (WHERE s.amount > 0
        AND (s.category || ' ' || COALESCE(s.product,'')) !~ 'PT|피티|퍼스널|개인'
        AND s.category ~ '단증|승단|심사'), 0)::bigint AS dan,
      COALESCE(SUM(s.amount) FILTER (WHERE s.amount > 0
        AND (s.category || ' ' || COALESCE(s.product,'')) !~ 'PT|피티|퍼스널|개인'
        AND s.category !~ '단증|승단|심사'
        AND s.category ~ '물품|용품|상품|기타|굿즈'), 0)::bigint AS goods,
      COALESCE(SUM(s.amount) FILTER (WHERE s.amount > 0
        AND (s.category || ' ' || COALESCE(s.product,'')) !~ 'PT|피티|퍼스널|개인'
        AND s.category !~ '단증|승단|심사'
        AND s.category !~ '물품|용품|상품|기타|굿즈'), 0)::bigint AS membership,
      COALESCE(SUM(-s.amount) FILTER (WHERE s.amount < 0), 0)::bigint AS refund_amt,
      COUNT(*) FILTER (WHERE s.amount < 0)::int AS refund_cnt
    FROM sales_entries s
    WHERE s.branch_id = _branch_id
      AND s.sale_date BETWEEN _from AND _to
    GROUP BY s.sale_date
  )
  INSERT INTO daily_reports AS dr
    (branch_id, report_date, revenue_pt, revenue_membership, revenue_goods, revenue_dan,
     refund_amount, refund_count)
  SELECT _branch_id, agg.d, agg.pt, agg.membership, agg.goods, agg.dan, agg.refund_amt, agg.refund_cnt
  FROM agg
  ON CONFLICT (branch_id, report_date) DO UPDATE SET
    revenue_pt = EXCLUDED.revenue_pt,
    revenue_membership = EXCLUDED.revenue_membership,
    revenue_goods = EXCLUDED.revenue_goods,
    revenue_dan = EXCLUDED.revenue_dan,
    refund_amount = EXCLUDED.refund_amount,
    refund_count = EXCLUDED.refund_count,
    updated_at = now();
  GET DIAGNOSTICS affected = ROW_COUNT;

  -- 그 기간에 매출 줄이 하나도 없게 된 날(전부 삭제·정정)은 0 으로 내린다.
  UPDATE daily_reports d
     SET revenue_pt = 0, revenue_membership = 0, revenue_goods = 0, revenue_dan = 0,
         refund_amount = 0, refund_count = 0, updated_at = now()
   WHERE d.branch_id = _branch_id
     AND d.report_date BETWEEN _from AND _to
     AND NOT EXISTS (
       SELECT 1 FROM sales_entries s
        WHERE s.branch_id = _branch_id AND s.sale_date = d.report_date)
     AND (d.revenue_pt + d.revenue_membership + d.revenue_goods + d.revenue_dan
          + COALESCE(d.refund_amount,0)) <> 0;

  RETURN affected;
END $function$;

REVOKE EXECUTE ON FUNCTION public.recalc_daily_revenue(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_daily_revenue(uuid, date, date) TO authenticated, service_role;

-- ── 롤백 ────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.recalc_daily_revenue(uuid, date, date);
-- (브로제이 동기화·엑셀 업로드의 rpc 호출도 함께 되돌려야 한다)

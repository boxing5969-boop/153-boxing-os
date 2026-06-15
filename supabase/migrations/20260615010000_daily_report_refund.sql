-- ============================================================
-- 일일 리포트에 환불 추가 (daily_reports 컬럼 2개 — 신규 테이블 아님)
--   refund_count  : 환불 건수
--   refund_amount : 환불 금액(원). 순매출 = 매출합 − 환불.
-- ============================================================
ALTER TABLE public.daily_reports
  ADD COLUMN IF NOT EXISTS refund_count  int    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_amount bigint NOT NULL DEFAULT 0 CHECK (refund_amount >= 0);

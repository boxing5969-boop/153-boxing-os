-- ============================================================
-- 환불 자동 계산기 — refund_requests (신규 1테이블)
-- 모든 접근은 Workers API(service_role) 경유. RLS 활성(클라 직접 차단).
-- 입력 전체는 input_snapshot(jsonb)에 보존, 핵심 금액·상태는 컬럼으로.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.refund_requests (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id                   uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_name                 text        NOT NULL,
  phone                       text,
  product_name                text,
  contract_type               text,       -- 기간권 / 회차권 / 혼합권
  refund_reason_type          text,       -- 소비자 / 센터 / 기타
  payment_method              text,       -- 카드 / 현금 / 계좌이체 / 기타
  payment_date                date,
  start_date                  date,
  end_date                    date,
  refund_requested_date       date,
  payment_amount              bigint      NOT NULL DEFAULT 0,
  tuition_amount              bigint      NOT NULL DEFAULT 0,
  total_days                  int         NOT NULL DEFAULT 0,
  elapsed_days                int         NOT NULL DEFAULT 0,
  remaining_days              int         NOT NULL DEFAULT 0,
  total_sessions              int         NOT NULL DEFAULT 0,
  used_sessions               int         NOT NULL DEFAULT 0,
  remaining_sessions          int         NOT NULL DEFAULT 0,
  penalty_rate                numeric     NOT NULL DEFAULT 0,
  penalty_amount              bigint      NOT NULL DEFAULT 0,
  used_amount                 bigint      NOT NULL DEFAULT 0,
  equipment_fee               bigint      NOT NULL DEFAULT 0,
  equipment_deducted          bigint      NOT NULL DEFAULT 0,
  additional_deduction_amount bigint      NOT NULL DEFAULT 0,
  calculated_refund_amount    bigint      NOT NULL DEFAULT 0,
  final_refund_amount         bigint      NOT NULL DEFAULT 0,
  rounding_type               text,
  refund_method               text,       -- card_partial_cancel / bank_transfer
  refund_status               text        NOT NULL DEFAULT 'draft',
  risk_level                  text,        -- 안전 / 주의 / 위험
  risk_messages               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  member_message              text,
  internal_memo               text,
  member_agreed               boolean     NOT NULL DEFAULT false,
  agreed_at                   timestamptz,
  card_approval_number        text,
  input_snapshot              jsonb,
  processed_by                uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  processed_at                timestamptz,
  created_by                  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refund_requests_branch_idx ON public.refund_requests (branch_id, created_at DESC);
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

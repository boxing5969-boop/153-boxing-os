-- ============================================================
-- 결제선생(Payssam) 청구서 발송 내역 테이블
-- ============================================================

-- 결제 요청 상태 enum
DO $$ BEGIN
  CREATE TYPE payment_request_status AS ENUM (
    'pending',    -- 청구서 발송됨, 미결제
    'paid',       -- 결제 완료
    'cancelled',  -- 취소됨
    'expired'     -- 만료 (미결제 기간 초과)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- payment_requests: 청구서 발송 내역
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_id         uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  membership_id     uuid REFERENCES public.memberships(id) ON DELETE SET NULL,

  -- 결제선생 연동
  payssam_bill_id   text UNIQUE,           -- 결제선생 청구서 ID
  payssam_bill_url  text,                  -- 결제 링크 URL

  -- 청구 정보
  amount            numeric(12,2) NOT NULL CHECK (amount > 0),
  description       text NOT NULL,         -- 청구 내용 (예: "2026년 6월 회원권")
  due_date          date,                  -- 납부 기한

  -- 발송 정보
  recipient_phone   text NOT NULL,         -- 수신자 전화번호 (하이픈 없이)
  sent_via          text DEFAULT 'sms'     -- 'sms' | 'kakao' | 'both'
    CHECK (sent_via IN ('sms', 'kakao', 'both')),

  -- 상태
  status            payment_request_status NOT NULL DEFAULT 'pending',
  paid_at           timestamptz,           -- 결제 완료 시각 (웹훅 수신 시점)

  -- 자동 발송 여부
  is_auto           boolean NOT NULL DEFAULT false,  -- 자동 발송(Cron) vs 수동 발송
  trigger_type      text,                            -- 'manual' | 'd7' | 'd3' | 'd1' | 'renewal'

  -- 메타
  created_by        uuid REFERENCES public.profiles(auth_user_id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_payment_requests_member     ON public.payment_requests(member_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_branch     ON public.payment_requests(branch_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status     ON public.payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_payssam    ON public.payment_requests(payssam_bill_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_created    ON public.payment_requests(created_at DESC);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.touch_payment_requests()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_payment_requests_updated_at ON public.payment_requests;
CREATE TRIGGER trg_payment_requests_updated_at
  BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_payment_requests();

-- RLS
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

-- hq_admin: 자사 company 전체 조회/삽입
CREATE POLICY "payment_requests_hq_select" ON public.payment_requests
  FOR SELECT TO authenticated
  USING (
    branch_id IN (
      SELECT b.id FROM public.branches b
      JOIN public.profiles p ON p.company_id = b.company_id
      WHERE p.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "payment_requests_hq_insert" ON public.payment_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    branch_id IN (
      SELECT b.id FROM public.branches b
      JOIN public.profiles p ON p.company_id = b.company_id
      WHERE p.auth_user_id = auth.uid()
    )
  );

-- branch_admin: 자기 지점만
CREATE POLICY "payment_requests_branch_update" ON public.payment_requests
  FOR UPDATE TO authenticated
  USING (
    branch_id IN (
      SELECT branch_id FROM public.profiles
      WHERE auth_user_id = auth.uid()
    )
  );

-- service_role: 웹훅 수신 시 상태 업데이트
GRANT SELECT, INSERT, UPDATE ON public.payment_requests TO service_role, authenticated;

-- RPC: 웹훅에서 결제 완료 처리 (Workers service_role 호출)
CREATE OR REPLACE FUNCTION public.mark_payment_completed(
  _payssam_bill_id text,
  _paid_at         timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE payment_requests
  SET status  = 'paid',
      paid_at = _paid_at
  WHERE payssam_bill_id = _payssam_bill_id
    AND status = 'pending';
END $$;

GRANT EXECUTE ON FUNCTION public.mark_payment_completed(text, timestamptz) TO service_role;

COMMENT ON TABLE public.payment_requests IS '결제선생 청구서 발송 내역 및 결제 상태 추적';

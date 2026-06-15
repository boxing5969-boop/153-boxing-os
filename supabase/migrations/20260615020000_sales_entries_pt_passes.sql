-- ============================================================
-- 매출 상세 입력 (신규 2테이블)
--   sales_entries : 수강권·물품·단증 등록 1건씩 (이름·종류·결제수단·금액)
--   pt_passes     : 복싱 PT 회차 관리 (이름·10/20회·남은횟수·노쇼)
-- 접근: 모두 Workers API(service_role) 경유. RLS 활성(클라 직접 차단).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sales_entries (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  sale_date      date        NOT NULL,
  member_name    text        NOT NULL,
  category       text        NOT NULL,            -- 수강권 / 물품 / 단증
  product        text        NOT NULL,            -- 라벨 (예: 무제한 3개월)
  is_new         boolean     NOT NULL DEFAULT true, -- 신규 true / 재등록 false
  payment_method text        NOT NULL,            -- 현금 / 카드 / 계좌이체
  amount         bigint      NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_by     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_entries_branch_date_idx ON public.sales_entries (branch_id, sale_date DESC);
ALTER TABLE public.sales_entries ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pt_passes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_name    text        NOT NULL,
  total_sessions int         NOT NULL,
  used_sessions  int         NOT NULL DEFAULT 0 CHECK (used_sessions >= 0),
  no_shows       int         NOT NULL DEFAULT 0 CHECK (no_shows >= 0),
  payment_method text,
  amount         bigint      NOT NULL DEFAULT 0 CHECK (amount >= 0),
  is_new         boolean     NOT NULL DEFAULT true,
  reg_date       date        NOT NULL DEFAULT CURRENT_DATE,
  status         text        NOT NULL DEFAULT 'active',  -- active / 완료
  created_by     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pt_passes_branch_idx ON public.pt_passes (branch_id, status, created_at DESC);
ALTER TABLE public.pt_passes ENABLE ROW LEVEL SECURITY;

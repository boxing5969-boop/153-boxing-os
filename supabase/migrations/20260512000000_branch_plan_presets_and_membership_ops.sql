-- ============================================================
-- 지점별 이용권 플랜 프리셋 + 홀딩/환불 기능
-- ============================================================

-- ===== 1. branch_plan_presets (지점별 이용권 설정) =====
CREATE TABLE IF NOT EXISTS public.branch_plan_presets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(trim(name)) >= 1),
  days        int  NOT NULL CHECK (days > 0),
  price       numeric(12,2) NOT NULL CHECK (price >= 0),
  description text,                     -- 부가 설명 (예: "PT 10회 포함")
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,   -- 낮을수록 먼저 표시
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branch_plan_presets_branch
  ON public.branch_plan_presets(branch_id, is_active, sort_order);

CREATE OR REPLACE FUNCTION public.touch_branch_plan_presets()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_bpp_updated_at ON public.branch_plan_presets;
CREATE TRIGGER trg_bpp_updated_at
  BEFORE UPDATE ON public.branch_plan_presets
  FOR EACH ROW EXECUTE FUNCTION public.touch_branch_plan_presets();

-- RLS
ALTER TABLE public.branch_plan_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bpp_hq_all" ON public.branch_plan_presets
  FOR ALL TO authenticated
  USING (public.is_hq_admin())
  WITH CHECK (public.is_hq_admin());

CREATE POLICY "bpp_branch_all" ON public.branch_plan_presets
  FOR ALL TO authenticated
  USING (public.is_branch_admin() AND branch_id = public.current_branch_id())
  WITH CHECK (public.is_branch_admin() AND branch_id = public.current_branch_id());

-- 조회는 같은 company 직원 모두 가능 (코치도 신규 이용권 등록 시 확인 필요)
CREATE POLICY "bpp_read_company" ON public.branch_plan_presets
  FOR SELECT TO authenticated
  USING (
    branch_id IN (
      SELECT b.id FROM public.branches b
      JOIN public.profiles p ON p.company_id = b.company_id
      WHERE p.auth_user_id = auth.uid()
    )
  );


-- ===== 2. membership_holds (홀딩 이력) =====
CREATE TABLE IF NOT EXISTS public.membership_holds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id  uuid NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  hold_start     date NOT NULL,
  hold_end       date,                  -- NULL = 아직 홀딩 중
  days_held      int,                   -- 종료 시 계산 (hold_end - hold_start)
  reason         text,
  created_by     uuid REFERENCES public.profiles(auth_user_id) ON DELETE SET NULL,
  resumed_by     uuid REFERENCES public.profiles(auth_user_id) ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now(),
  resumed_at     timestamptz,
  CONSTRAINT holds_date_order CHECK (hold_end IS NULL OR hold_end >= hold_start)
);

CREATE INDEX IF NOT EXISTS idx_membership_holds_membership
  ON public.membership_holds(membership_id);

-- RLS
ALTER TABLE public.membership_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "holds_hq_all" ON public.membership_holds
  FOR ALL TO authenticated USING (public.is_hq_admin()) WITH CHECK (public.is_hq_admin());

CREATE POLICY "holds_branch_all" ON public.membership_holds
  FOR ALL TO authenticated
  USING (
    public.is_branch_admin() AND EXISTS (
      SELECT 1 FROM public.memberships ms
      WHERE ms.id = membership_holds.membership_id
        AND ms.branch_id = public.current_branch_id()
    )
  )
  WITH CHECK (
    public.is_branch_admin() AND EXISTS (
      SELECT 1 FROM public.memberships ms
      WHERE ms.id = membership_holds.membership_id
        AND ms.branch_id = public.current_branch_id()
    )
  );


-- ===== 3. memberships 컬럼 추가 =====
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS hold_start      date,         -- 현재 홀딩 시작일
  ADD COLUMN IF NOT EXISTS hold_end        date,         -- 현재 홀딩 예정 종료일
  ADD COLUMN IF NOT EXISTS total_held_days int DEFAULT 0, -- 누적 홀딩 일수
  ADD COLUMN IF NOT EXISTS refund_amount   numeric(12,2),
  ADD COLUMN IF NOT EXISTS refund_reason   text,
  ADD COLUMN IF NOT EXISTS refunded_at     timestamptz,
  ADD COLUMN IF NOT EXISTS notes           text;         -- 관리자 메모

-- ===== 4. RPC: 홀딩 시작 =====
CREATE OR REPLACE FUNCTION public.start_membership_hold(
  _membership_id uuid,
  _hold_start    date,
  _hold_end      date DEFAULT NULL,
  _reason        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ms     memberships;
  caller_auth_id uuid := auth.uid();
  new_hold_id uuid;
BEGIN
  -- 권한 체크
  IF NOT (public.is_hq_admin() OR public.is_branch_admin()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT * INTO ms FROM memberships WHERE id = _membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND'; END IF;
  IF ms.status != 'active' THEN
    RAISE EXCEPTION 'NOT_ACTIVE: 활성 이용권만 홀딩할 수 있습니다.';
  END IF;
  IF ms.hold_start IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_ON_HOLD: 이미 홀딩 중입니다.';
  END IF;
  IF _hold_start < CURRENT_DATE THEN
    RAISE EXCEPTION 'INVALID_DATE: 홀딩 시작일은 오늘 이후여야 합니다.';
  END IF;

  -- 이용권 상태 → paused
  UPDATE memberships
  SET status     = 'paused',
      hold_start = _hold_start,
      hold_end   = _hold_end
  WHERE id = _membership_id;

  -- 홀딩 이력 기록
  INSERT INTO membership_holds (membership_id, hold_start, hold_end, reason, created_by)
  VALUES (_membership_id, _hold_start, _hold_end, _reason, caller_auth_id)
  RETURNING id INTO new_hold_id;

  RETURN jsonb_build_object('hold_id', new_hold_id, 'status', 'paused');
END $$;

GRANT EXECUTE ON FUNCTION public.start_membership_hold(uuid, date, date, text) TO authenticated;


-- ===== 5. RPC: 홀딩 해제 (재개) =====
CREATE OR REPLACE FUNCTION public.resume_membership_hold(
  _membership_id uuid,
  _resume_date   date DEFAULT NULL   -- NULL = 오늘
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ms            memberships;
  hold_rec      membership_holds;
  resume_date   date := COALESCE(_resume_date, CURRENT_DATE);
  days_held     int;
  new_end_date  date;
  caller_auth_id uuid := auth.uid();
BEGIN
  IF NOT (public.is_hq_admin() OR public.is_branch_admin()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT * INTO ms FROM memberships WHERE id = _membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND'; END IF;
  IF ms.status != 'paused' THEN
    RAISE EXCEPTION 'NOT_ON_HOLD: 홀딩 중인 이용권이 아닙니다.';
  END IF;

  -- 진행 중인 홀딩 이력 조회
  SELECT * INTO hold_rec
  FROM membership_holds
  WHERE membership_id = _membership_id AND hold_end IS NULL
  ORDER BY created_at DESC LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'HOLD_RECORD_NOT_FOUND'; END IF;

  -- 홀딩 일수 계산 (시작일 포함)
  days_held := GREATEST(0, resume_date - hold_rec.hold_start);

  -- 종료일 연장: 원래 end_date + 홀딩 일수
  new_end_date := ms.end_date + days_held;

  -- 홀딩 이력 종료
  UPDATE membership_holds
  SET hold_end   = resume_date,
      days_held  = days_held,
      resumed_by = caller_auth_id,
      resumed_at = now()
  WHERE id = hold_rec.id;

  -- 이용권 재개
  UPDATE memberships
  SET status          = 'active',
      hold_start      = NULL,
      hold_end        = NULL,
      total_held_days = total_held_days + days_held,
      end_date        = new_end_date
  WHERE id = _membership_id;

  RETURN jsonb_build_object(
    'days_held',    days_held,
    'new_end_date', new_end_date,
    'status',       'active'
  );
END $$;

GRANT EXECUTE ON FUNCTION public.resume_membership_hold(uuid, date) TO authenticated;


-- ===== 6. RPC: 환불 처리 =====
CREATE OR REPLACE FUNCTION public.refund_membership(
  _membership_id  uuid,
  _refund_amount  numeric DEFAULT NULL,
  _refund_reason  text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ms memberships;
BEGIN
  IF NOT (public.is_hq_admin() OR public.is_branch_admin()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT * INTO ms FROM memberships WHERE id = _membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND'; END IF;
  IF ms.payment_status = 'refunded' THEN
    RAISE EXCEPTION 'ALREADY_REFUNDED: 이미 환불 처리된 이용권입니다.';
  END IF;

  UPDATE memberships
  SET status         = 'canceled',
      payment_status = 'refunded',
      hold_start     = NULL,
      hold_end       = NULL,
      refund_amount  = _refund_amount,
      refund_reason  = _refund_reason,
      refunded_at    = now()
  WHERE id = _membership_id;

  RETURN jsonb_build_object('status', 'refunded', 'refund_amount', _refund_amount);
END $$;

GRANT EXECUTE ON FUNCTION public.refund_membership(uuid, numeric, text) TO authenticated;


-- ===== 7. GRANT =====
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_plan_presets TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.membership_holds TO authenticated;

-- ============================================================
-- 마이복서앱 회원 셀프서비스 — 체크아웃 / 결제완료 자동활성 / 홀딩
-- ------------------------------------------------------------
-- 회원이 마이복서앱에서: 이용권 결제 → (결제선생) → 결제성공 시 회원권
-- 자동 생성·활성 + 출입권한 부여(브로제이 동기화는 트리거 자동). 홀딩 신청.
--  · 모든 RPC service_role 전용(파트너 인증된 워커 경유) — 관장 권한 불필요
--  · 결제선생 미연동(키 대기) 동안엔 mock provider 로 동작
-- 환불 자동계산은 별도(다음 단계, RefundCalculator 서버 포팅).
-- ============================================================

-- payment_requests 에 상품 정보 보관(결제성공 시 회원권 생성용)
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS plan_name   text,
  ADD COLUMN IF NOT EXISTS plan_months int;

-- ── 1) 체크아웃: 결제요청 생성 ───────────────────────────────
CREATE OR REPLACE FUNCTION public.app_checkout(
  _member_id    uuid,
  _product_name text,
  _amount       numeric,
  _months       int,
  _purpose      text DEFAULT 'new_membership'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m     public.members;
  _brand uuid;
  _pr_id uuid;
  _purp  text;
BEGIN
  SELECT * INTO _m FROM public.members WHERE id = _member_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND'; END IF;
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT id INTO _brand FROM public.brands
   WHERE company_id = _m.company_id ORDER BY created_at LIMIT 1;
  IF _brand IS NULL THEN RAISE EXCEPTION 'BRAND_NOT_FOUND'; END IF;

  _purp := CASE WHEN _purpose IN ('new_membership','renewal','pt','product','other')
                THEN _purpose ELSE 'new_membership' END;

  INSERT INTO public.payment_requests(
    company_id, brand_id, branch_id, member_id, purpose,
    amount, status, plan_name, plan_months
  ) VALUES (
    _m.company_id, _brand, _m.branch_id, _m.id, _purp,
    _amount, 'pending', _product_name, _months
  ) RETURNING id INTO _pr_id;

  RETURN jsonb_build_object(
    'payment_request_id', _pr_id,
    'amount', _amount,
    'product_name', _product_name,
    'months', _months,
    'status', 'pending'
  );
END;
$$;

-- ── 2) 결제성공 → 회원권 자동 생성·활성 + 출입권한 부여 ──────────
--    (memberships INSERT 트리거가 device_sync_jobs enqueue·members active 자동)
CREATE OR REPLACE FUNCTION public.app_activate_paid_membership(
  _payment_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _pr    public.payment_requests;
  _ms_id uuid;
  _end   date;
  _mon   int;
BEGIN
  SELECT * INTO _pr FROM public.payment_requests
   WHERE id = _payment_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_REQUEST_NOT_FOUND'; END IF;

  -- 멱등: 이미 활성 처리됨
  IF _pr.status = 'paid' AND _pr.membership_id IS NOT NULL THEN
    RETURN jsonb_build_object('membership_id', _pr.membership_id, 'already', true);
  END IF;
  IF _pr.member_id IS NULL THEN RAISE EXCEPTION 'NO_MEMBER_ON_REQUEST'; END IF;

  _mon := COALESCE(_pr.plan_months, 1);
  _end := CURRENT_DATE + (_mon || ' months')::interval;

  INSERT INTO public.memberships(
    member_id, branch_id, plan_name, start_date, end_date, payment_status, status
  ) VALUES (
    _pr.member_id, _pr.branch_id, COALESCE(_pr.plan_name, '멤버십'),
    CURRENT_DATE, _end, 'paid', 'active'
  ) RETURNING id INTO _ms_id;

  INSERT INTO public.access_grants(
    member_id, branch_id, grant_type, valid_from, valid_until, status
  ) VALUES (
    _pr.member_id, _pr.branch_id, 'membership', CURRENT_DATE, _end, 'active'
  );

  UPDATE public.payment_requests
     SET status = 'paid', paid_at = now(), membership_id = _ms_id, updated_at = now()
   WHERE id = _payment_request_id;

  RETURN jsonb_build_object('membership_id', _ms_id, 'end_date', _end, 'already', false);
END;
$$;

-- ── 3) 홀딩 신청(권별 정책 자동가드) ─────────────────────────
--    정책: 1개월 7일·1회 / 3개월 15일·1회 / 5개월 30일·1회 / 12개월 60일·2회
--    (그 외 개월수는 가장 가까운 하위 구간 적용)
CREATE OR REPLACE FUNCTION public.app_request_hold(
  _member_id   uuid,
  _hold_start  date,
  _hold_end    date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ms        public.memberships;
  _months    int;
  _max_days  int;
  _max_count int;
  _used_days int;
  _cnt       int;
  _req_days  int;
BEGIN
  IF _hold_start IS NULL OR _hold_end IS NULL OR _hold_end < _hold_start THEN
    RAISE EXCEPTION 'INVALID_DATE: 홀딩 기간을 확인해주세요';
  END IF;
  IF _hold_start < CURRENT_DATE THEN
    RAISE EXCEPTION 'INVALID_DATE: 홀딩 시작일은 오늘 이후여야 합니다';
  END IF;

  SELECT * INTO _ms FROM public.memberships
   WHERE member_id = _member_id AND status = 'active'
   ORDER BY end_date DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ACTIVE_MEMBERSHIP: 활성 이용권이 없습니다'; END IF;
  IF _ms.hold_start IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_ON_HOLD: 이미 홀딩 중입니다'; END IF;

  _months := GREATEST(1, ROUND((_ms.end_date - _ms.start_date) / 30.0)::int);
  IF    _months >= 12 THEN _max_days := 60; _max_count := 2;
  ELSIF _months >= 5  THEN _max_days := 30; _max_count := 1;
  ELSIF _months >= 3  THEN _max_days := 15; _max_count := 1;
  ELSE                     _max_days := 7;  _max_count := 1;
  END IF;

  SELECT count(*),
         COALESCE(SUM(COALESCE(days_held, (COALESCE(hold_end, hold_start) - hold_start) + 1)), 0)
    INTO _cnt, _used_days
    FROM public.membership_holds WHERE membership_id = _ms.id;

  _req_days := (_hold_end - _hold_start) + 1;

  IF _cnt >= _max_count THEN
    RAISE EXCEPTION 'HOLD_COUNT_EXCEEDED: 홀딩 가능 횟수(%회)를 초과했습니다', _max_count;
  END IF;
  IF _used_days + _req_days > _max_days THEN
    RAISE EXCEPTION 'HOLD_DAYS_EXCEEDED: 홀딩 가능 일수(%일)를 초과했습니다', _max_days;
  END IF;

  -- 적용: 만료일 연장 + paused (트리거가 출입 disable 동기화 enqueue)
  UPDATE public.memberships
     SET status = 'paused', hold_start = _hold_start, hold_end = _hold_end,
         end_date = end_date + _req_days, updated_at = now()
   WHERE id = _ms.id;

  INSERT INTO public.membership_holds(membership_id, hold_start, hold_end, days_held, reason)
  VALUES (_ms.id, _hold_start, _hold_end, _req_days, 'app_self');

  UPDATE public.access_grants
     SET status = 'suspended'
   WHERE member_id = _member_id AND grant_type = 'membership' AND status = 'active';

  RETURN jsonb_build_object(
    'held', true, 'days', _req_days,
    'new_end_date', _ms.end_date + _req_days,
    'max_days', _max_days, 'max_count', _max_count,
    'used_days', _used_days + _req_days, 'count', _cnt + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_checkout(uuid,text,numeric,int,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_activate_paid_membership(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.app_request_hold(uuid,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_checkout(uuid,text,numeric,int,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_activate_paid_membership(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_request_hold(uuid,date,date) TO service_role;

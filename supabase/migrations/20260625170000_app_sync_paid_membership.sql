-- ============================================================
-- 외부결제(마이복서 결제선생) → 153OS 회원권 동기화
-- ------------------------------------------------------------
-- 마이복서 payssam-callback 이 결제 성공 시 호출. 외부주문ID(_ext_order_id)로 멱등.
-- 검증된 app_register_member(회원 확보·동의기록) + app_activate_paid_membership
-- (회원권 active/paid + access_grant + 단말기 동기화 트리거)를 재사용한다.
-- service_role 전용.
-- ============================================================

-- 멱등 보장용 유니크 인덱스(외부주문ID = idempotency_key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_idem
  ON public.payment_requests (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.app_sync_paid_membership(
  _ranking_user_id uuid,
  _branch_id       uuid,
  _name            text,
  _phone           text,
  _plan_name       text,
  _amount          int,
  _months          int,
  _ext_order_id    text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _member   public.members;
  _existing public.payment_requests;
  _pr_id    uuid;
  _act      jsonb;
  _key      text;
BEGIN
  IF coalesce(btrim(_ext_order_id), '') = '' THEN
    RAISE EXCEPTION 'EXT_ORDER_ID_REQUIRED: 외부 주문ID가 필요합니다';
  END IF;
  _key := 'payssam:' || _ext_order_id;

  -- 멱등: 같은 외부주문ID로 이미 동기화됐으면 그대로 반환
  SELECT * INTO _existing FROM public.payment_requests WHERE idempotency_key = _key LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'member_id', _existing.member_id,
      'membership_id', _existing.membership_id,
      'idempotent', true
    );
  END IF;

  -- 회원 확보(앱유저ID→전화 매칭, 없으면 생성 + 동의기록) — 검증된 RPC 재사용.
  -- 결제 완료 회원이므로 개인정보·약관 동의는 true(마이복서 가입 시 동의).
  _member := public.app_register_member(
    _ranking_user_id, _branch_id, coalesce(nullif(btrim(_name), ''), '회원'),
    _phone, NULL, NULL, true, true, false
  );

  -- 결제요청 기록(멱등키=외부주문ID) → 활성화 RPC 재사용(회원권+출입권한+단말기동기화)
  INSERT INTO public.payment_requests(
    branch_id, member_id, purpose, amount, currency, status,
    provider, provider_ref, idempotency_key, plan_name, plan_months
  ) VALUES (
    _branch_id, _member.id, 'new_membership', _amount, 'KRW', 'pending',
    'payssam', _ext_order_id, _key, _plan_name, greatest(1, coalesce(_months, 0))
  ) RETURNING id INTO _pr_id;

  _act := public.app_activate_paid_membership(_pr_id);

  RETURN jsonb_build_object(
    'member_id', _member.id,
    'membership_id', _act ->> 'membership_id',
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_sync_paid_membership(uuid,uuid,text,text,text,int,int,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_sync_paid_membership(uuid,uuid,text,text,text,int,int,text)
  TO service_role;

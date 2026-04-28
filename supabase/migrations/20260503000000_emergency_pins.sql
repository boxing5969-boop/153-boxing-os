-- Phase 13 마이그레이션: 비상 PIN 발급/검증
-- 시나리오: 단말기 장애 / 회원 신분 확인 불가 시 hq/branch_admin 가 1회용 PIN 발급
-- PIN 평문 저장 금지 — bcrypt(crypt + gen_salt('bf')) 해시.
-- 검증은 Workers /api/access/verify 가 consume_emergency_pin RPC 호출.

CREATE TYPE emergency_pin_status AS ENUM ('active', 'used', 'expired', 'revoked');

CREATE TABLE emergency_pins (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  pin_hash     text NOT NULL,
  purpose      text,
  issued_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  max_uses     int NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  used_count   int NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  status       emergency_pin_status NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_emergency_pins_active
  ON emergency_pins(branch_id, status, expires_at)
  WHERE status = 'active';

CREATE INDEX idx_emergency_pins_issuer ON emergency_pins(issued_by);

-- ============================================================
-- RLS — hq 전체 / branch_admin 자기 지점만
-- ============================================================
ALTER TABLE emergency_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY pins_hq_select ON emergency_pins
  FOR SELECT TO authenticated
  USING (is_hq_admin());

CREATE POLICY pins_branch_select ON emergency_pins
  FOR SELECT TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id());

-- INSERT/UPDATE 는 RPC 경유만 (정책 없음 = 일반 authenticated 차단, service_role 만 가능)

-- ============================================================
-- issue_emergency_pin — CRM 에서 호출 (1회 평문 노출)
-- ============================================================
CREATE OR REPLACE FUNCTION public.issue_emergency_pin(
  _branch_id uuid,
  _purpose text DEFAULT NULL,
  _ttl_minutes int DEFAULT 10,
  _max_uses int DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pin_text text;
  pin_id uuid;
  caller_profile_id uuid;
  expires timestamptz;
BEGIN
  -- 권한: hq OR 자기 지점 branch_admin
  IF NOT (
    public.is_hq_admin()
    OR (public.is_branch_admin() AND public.current_branch_id() = _branch_id)
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF _ttl_minutes < 1 OR _ttl_minutes > 1440 THEN
    RAISE EXCEPTION 'ttl_minutes must be between 1 and 1440';
  END IF;
  IF _max_uses < 1 OR _max_uses > 100 THEN
    RAISE EXCEPTION 'max_uses must be between 1 and 100';
  END IF;

  SELECT id INTO caller_profile_id FROM profiles WHERE auth_user_id = auth.uid() LIMIT 1;

  -- 6자리 0-padded PIN
  pin_text := lpad(floor(random() * 1000000)::int::text, 6, '0');
  expires := now() + (_ttl_minutes || ' minutes')::interval;

  INSERT INTO emergency_pins (
    branch_id, pin_hash, purpose, issued_by, expires_at, max_uses
  ) VALUES (
    _branch_id,
    crypt(pin_text, gen_salt('bf')),
    _purpose,
    caller_profile_id,
    expires,
    _max_uses
  )
  RETURNING id INTO pin_id;

  RETURN jsonb_build_object(
    'pin_id', pin_id,
    'pin', pin_text,
    'branch_id', _branch_id,
    'expires_at', expires,
    'max_uses', _max_uses,
    'issued_by', caller_profile_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.issue_emergency_pin(uuid, text, int, int) TO authenticated;

-- ============================================================
-- consume_emergency_pin — Workers /api/access/verify 가 호출 (PIN credential)
-- ============================================================
CREATE OR REPLACE FUNCTION public.consume_emergency_pin(
  _branch_id uuid,
  _pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pin_row emergency_pins%ROWTYPE;
BEGIN
  -- 만료 PIN 자동 expired 처리
  UPDATE emergency_pins
     SET status = 'expired'
   WHERE branch_id = _branch_id
     AND status = 'active'
     AND expires_at < now();

  -- 일치하는 활성 PIN 찾기 (해시 비교)
  SELECT * INTO pin_row
  FROM emergency_pins
  WHERE branch_id = _branch_id
    AND status = 'active'
    AND used_count < max_uses
    AND expires_at >= now()
    AND pin_hash = crypt(_pin, pin_hash)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_or_expired');
  END IF;

  -- 사용 카운트 증가 + 모두 소진 시 'used'
  UPDATE emergency_pins
     SET used_count = used_count + 1,
         last_used_at = now(),
         status = CASE
           WHEN used_count + 1 >= max_uses THEN 'used'::emergency_pin_status
           ELSE status
         END
   WHERE id = pin_row.id;

  RETURN jsonb_build_object(
    'success', true,
    'pin_id', pin_row.id,
    'issued_by', pin_row.issued_by,
    'purpose', pin_row.purpose
  );
END $$;

GRANT EXECUTE ON FUNCTION public.consume_emergency_pin(uuid, text) TO service_role;

-- ============================================================
-- revoke_emergency_pin — 발급자 또는 hq 가 PIN 취소
-- ============================================================
CREATE OR REPLACE FUNCTION public.revoke_emergency_pin(_pin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pin_row emergency_pins%ROWTYPE;
BEGIN
  SELECT * INTO pin_row FROM emergency_pins WHERE id = _pin_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PIN not found';
  END IF;

  IF NOT (
    public.is_hq_admin()
    OR (public.is_branch_admin() AND public.current_branch_id() = pin_row.branch_id)
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  UPDATE emergency_pins SET status = 'revoked' WHERE id = _pin_id;
  RETURN jsonb_build_object('pin_id', _pin_id, 'status', 'revoked');
END $$;

GRANT EXECUTE ON FUNCTION public.revoke_emergency_pin(uuid) TO authenticated;

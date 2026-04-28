-- ============================================================
-- 153os SaaS: companies 테이블에 구독/트라이얼 필드 추가
-- + onboarding signup 함수
-- ============================================================

-- 1) companies 확장
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS slug              text UNIQUE,
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trial'
    CHECK (subscription_status IN ('trial', 'active', 'expired', 'suspended')),
  ADD COLUMN IF NOT EXISTS trial_ends_at     timestamptz,
  ADD COLUMN IF NOT EXISTS plan              text DEFAULT 'starter'
    CHECK (plan IN ('starter', 'growth', 'enterprise'));

COMMENT ON COLUMN public.companies.slug             IS 'URL-friendly unique identifier (e.g. 153boxing)';
COMMENT ON COLUMN public.companies.subscription_status IS 'SaaS subscription state';
COMMENT ON COLUMN public.companies.trial_ends_at    IS '14-day free trial expiry';
COMMENT ON COLUMN public.companies.plan             IS 'SaaS plan tier';

-- 2) provision_new_company() — Workers에서 service_role로 호출
--    auth.users 레코드 생성은 Supabase Admin API (Workers 측)에서 처리
--    이 함수는 company/branch/profile row만 생성하고 company_id를 반환
CREATE OR REPLACE FUNCTION public.provision_new_company(
  _company_name   text,
  _slug           text,
  _branch_name    text,
  _branch_phone   text,
  _admin_name     text,
  _admin_phone    text,
  _auth_user_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_id uuid;
  _branch_id  uuid;
BEGIN
  -- company 생성
  INSERT INTO companies (name, slug, subscription_status, trial_ends_at, plan)
  VALUES (
    _company_name,
    lower(trim(_slug)),
    'trial',
    now() + interval '14 days',
    'starter'
  )
  RETURNING id INTO _company_id;

  -- 첫 지점 생성
  INSERT INTO branches (company_id, name, phone, status)
  VALUES (_company_id, _branch_name, _branch_phone, 'active')
  RETURNING id INTO _branch_id;

  -- hq_admin 프로필 생성
  INSERT INTO profiles (auth_user_id, company_id, branch_id, name, phone, role, status)
  VALUES (_auth_user_id, _company_id, _branch_id, _admin_name, _admin_phone, 'hq_admin', 'active');

  RETURN _company_id;
END $$;

GRANT EXECUTE ON FUNCTION public.provision_new_company(text,text,text,text,text,text,uuid)
  TO service_role;

-- 3) check_slug_available() — 회원가입 중 slug 중복 확인 (public)
CREATE OR REPLACE FUNCTION public.check_slug_available(_slug text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM companies WHERE slug = lower(trim(_slug)));
$$;

GRANT EXECUTE ON FUNCTION public.check_slug_available(text) TO anon, authenticated;

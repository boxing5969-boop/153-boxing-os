-- ============================================================
-- Phase 20A-1: B2B SaaS Tenant Foundation
-- ============================================================
-- 결정 사항 (Phase 20 분석 + 사용자 확인 결과):
--   1) companies 가 곧 tenant. 새 테이블의 tenant_id 컬럼은 companies(id) 참조.
--      별도 tenants 테이블 생성하지 않음 (기존 60+ 마이그레이션 호환).
--   2) tenant_users 별도 테이블 만들지 않음 — 기존 profiles + staff_roles 가 동일 역할.
--      profiles.status CHECK 에 'invited','suspended' 값 추가.
--   3) 모든 신규 비즈니스 테이블은 tenant_id 필수 (글로벌/시스템 테이블 제외).
--   4) 멱등 — 모든 DDL 은 IF NOT EXISTS / IF EXISTS / DO 블록.
--   5) 100+ 가맹점 안전 운영 목표 — RLS 정책은 tenant 격리 보장.
-- ============================================================

-- ── companies 확장 (= tenants) ────────────────────────────────
-- 기존: id, name, business_type, created_at + (saas_onboarding 으로 slug/subscription_status/
--       trial_ends_at/plan 추가됨)
-- 추가: business_name, business_registration_number, owner_user_id, plan_code, status, updated_at
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS business_name                text,
  ADD COLUMN IF NOT EXISTS business_registration_number text,
  ADD COLUMN IF NOT EXISTS owner_user_id                uuid,   -- auth.users.id (FK 미연결: 계정 삭제돼도 회사 보존)
  ADD COLUMN IF NOT EXISTS plan_code                    text,
  ADD COLUMN IF NOT EXISTS updated_at                   timestamptz NOT NULL DEFAULT now();

-- spec 요구 status: active/suspended/cancelled (구독 상태인 subscription_status 와 분리)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_status_check'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_status_check
      CHECK (status IN ('active','suspended','cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_companies_owner_user_id ON public.companies(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_status ON public.companies(status);

DROP TRIGGER IF EXISTS trg_companies_updated_at ON public.companies;
CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── branches: spec 일치 확인 + updated_at 보장 ─────────────────
-- 기존 branches 는 이미 company_id, name, phone, address, status, created_at 보유.
-- updated_at 은 tenancy_columns 에서 이미 추가됨. updated_at 트리거만 확보.
DROP TRIGGER IF EXISTS trg_branches_updated_at ON public.branches;
CREATE TRIGGER trg_branches_updated_at BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── profiles.status 확장: 'invited','suspended' 허용 ──────────
-- 기존 init_tables 에서 profiles 가 생성됐을 때 status DEFAULT 'active' 만 두고 CHECK 가 없었을 수 있음.
-- 안전하게: 기존 CHECK 가 있으면 drop → 새 CHECK 추가.
DO $$
DECLARE
  v_cn text;
BEGIN
  SELECT con.conname INTO v_cn
  FROM pg_constraint con
  JOIN pg_class cls ON cls.oid = con.conrelid
  WHERE cls.relname = 'profiles'
    AND cls.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%';
  IF v_cn IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', v_cn);
  END IF;

  -- 새 CHECK 추가 (기존 값 'active' 포함 + 'invited','suspended','inactive' 추가)
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_status_check
    CHECK (status IN ('active','invited','suspended','inactive'));
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already exists
END $$;

-- ── members: tenant_id 별칭 컬럼 보장 (alias 가 아닌 view 로 노출하진 않음) ───
-- 기존 members 는 이미 company_id, branch_id, name, phone, status, memo(?), created_at, updated_at(?)
-- updated_at 트리거가 없으면 추가.
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS memo       text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_members_updated_at ON public.members;
CREATE TRIGGER trg_members_updated_at BEFORE UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 헬퍼 함수 (RLS 전용, SECURITY DEFINER)
-- ============================================================

-- is_tenant_member: 현재 인증된 사용자가 해당 tenant 소속인지
CREATE OR REPLACE FUNCTION public.is_tenant_member(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid()
      AND company_id   = p_tenant_id
      AND status       = 'active'
  );
$$;
REVOKE ALL ON FUNCTION public.is_tenant_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid) TO authenticated, service_role;

-- has_tenant_role: 현재 인증된 사용자가 해당 tenant 에서 지정된 역할 중 하나를 가지는지
-- profiles.role(단일) + staff_roles(다중) 둘 다 검사.
CREATE OR REPLACE FUNCTION public.has_tenant_role(p_tenant_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = auth.uid()
      AND company_id   = p_tenant_id
      AND status       = 'active'
      AND role::text   = ANY(p_roles)
  )
  OR EXISTS (
    SELECT 1 FROM public.staff_roles sr
    JOIN public.profiles p ON p.id = sr.profile_id
    WHERE p.auth_user_id = auth.uid()
      AND sr.company_id  = p_tenant_id
      AND sr.status      = 'active'
      AND sr.role::text  = ANY(p_roles)
  );
$$;
REVOKE ALL ON FUNCTION public.has_tenant_role(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_tenant_role(uuid, text[]) TO authenticated, service_role;

DO $$ BEGIN
  RAISE NOTICE 'Phase 20A-1: tenant foundation 완료 — companies 확장 + profiles.status + helpers';
END $$;

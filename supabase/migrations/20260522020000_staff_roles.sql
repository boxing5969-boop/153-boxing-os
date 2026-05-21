-- ============================================================
-- 멀티테넌트 1차-A: staff_roles — 다중 역할 배정 테이블
-- ============================================================
-- 한 직원(profile)이 여러 지점/브랜드에 역할을 가질 수 있도록 지원.
-- profiles.role(단일 역할)은 그대로 두고, staff_roles 를 추가로 둔다.
-- 1차에서는 기존 user_role enum 값만 사용(enum 확장은 Phase B).
-- RLS 등 다른 테이블이 staff_roles 에 의존하게 만드는 작업도 Phase B.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_roles (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid        NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id    uuid        REFERENCES public.brands(id)   ON DELETE CASCADE,
  branch_id   uuid        REFERENCES public.branches(id) ON DELETE CASCADE,
  role        user_role   NOT NULL,
  scope       text        NOT NULL DEFAULT 'branch'
                          CHECK (scope IN ('organization','brand','branch')),
  status      text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','inactive')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  created_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_roles_profile ON public.staff_roles(profile_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_roles_company ON public.staff_roles(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_roles_branch  ON public.staff_roles(branch_id)  WHERE deleted_at IS NULL;

CREATE OR REPLACE TRIGGER trg_staff_roles_updated_at
  BEFORE UPDATE ON public.staff_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 백필: 기존 profiles 의 역할을 staff_roles 로 복제 ───────
INSERT INTO public.staff_roles (profile_id, company_id, brand_id, branch_id, role, scope)
SELECT p.id, p.company_id, b.brand_id, p.branch_id, p.role,
       CASE WHEN p.role IN ('super_admin','hq_admin') THEN 'organization' ELSE 'branch' END
FROM public.profiles p
LEFT JOIN public.branches b ON b.id = p.branch_id
WHERE p.company_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.staff_roles sr WHERE sr.profile_id = p.id);

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.staff_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_roles TO authenticated;

-- 본사 관리자: 전체 관리
CREATE POLICY staff_roles_hq_all ON public.staff_roles
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());

-- 그 외: 자기 회사 역할 배정 조회만
CREATE POLICY staff_roles_company_select ON public.staff_roles
  FOR SELECT TO authenticated
  USING (company_id = current_company_id());

DO $$ BEGIN
  RAISE NOTICE 'staff_roles 테이블 + 기존 역할 백필 완료';
END $$;

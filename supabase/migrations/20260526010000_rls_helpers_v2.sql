-- ============================================================
-- Phase B-2: staff_roles 기반 RLS 헬퍼 (추가형)
-- ============================================================
-- 한 직원이 여러 지점/브랜드 권한을 가질 수 있도록 staff_roles 를
-- 진실원으로 읽는 신규 헬퍼들. 기존 헬퍼(is_hq_admin / is_branch_admin /
-- current_branch_id)는 그대로 유지(하위호환) — 본 마이그레이션은 추가만 한다.
--
-- staff_roles.scope: organization | brand | branch
-- ============================================================

-- ── 접근 가능 지점 집합 ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accessible_branch_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- super_admin: 전 지점
  SELECT b.id FROM public.branches b
  WHERE EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid() AND p.role = 'super_admin'
  )
  UNION
  -- staff_roles 배정 기반 (스코프별)
  SELECT b.id FROM public.branches b
  WHERE EXISTS (
    SELECT 1
    FROM public.staff_roles sr
    JOIN public.profiles p ON p.id = sr.profile_id
    WHERE p.auth_user_id = auth.uid()
      AND sr.status = 'active'
      AND (
        (sr.scope = 'organization' AND b.company_id = sr.company_id)
        OR (sr.scope = 'brand'  AND b.brand_id = sr.brand_id)
        OR (sr.scope = 'branch' AND b.id       = sr.branch_id)
      )
  );
$$;

-- ── 접근 가능 브랜드 집합 ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.accessible_brand_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT br.id FROM public.brands br
  WHERE EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid() AND p.role = 'super_admin'
  )
  UNION
  SELECT br.id FROM public.brands br
  WHERE EXISTS (
    SELECT 1
    FROM public.staff_roles sr
    JOIN public.profiles p ON p.id = sr.profile_id
    WHERE p.auth_user_id = auth.uid()
      AND sr.status = 'active'
      AND (
        (sr.scope = 'organization' AND br.company_id = sr.company_id)
        OR (sr.scope IN ('brand','branch') AND br.id = sr.brand_id)
      )
  );
$$;

-- ── 특정 지점 접근 가능 여부 ────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_branch_access(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_branch_id IN (SELECT public.accessible_branch_ids());
$$;

-- ── 특정 조직(회사) 접근 가능 여부 ──────────────────────────
CREATE OR REPLACE FUNCTION public.has_org_access(p_company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid() AND p.role = 'super_admin'
  ) OR EXISTS (
    SELECT 1 FROM public.staff_roles sr
    JOIN public.profiles p ON p.id = sr.profile_id
    WHERE p.auth_user_id = auth.uid() AND sr.status = 'active'
      AND sr.company_id = p_company_id
  );
$$;

-- ── 조직 관리자 여부 (super_admin / hq_admin / owner) ───────
CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.role IN ('super_admin','hq_admin','owner')
  ) OR EXISTS (
    SELECT 1 FROM public.staff_roles sr
    JOIN public.profiles p ON p.id = sr.profile_id
    WHERE p.auth_user_id = auth.uid() AND sr.status = 'active'
      AND sr.role IN ('super_admin','hq_admin','owner')
  );
$$;

-- ── 정산 담당(accountant) 여부 ──────────────────────────────
CREATE OR REPLACE FUNCTION public.is_accountant()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid() AND p.role = 'accountant'
  ) OR EXISTS (
    SELECT 1 FROM public.staff_roles sr
    JOIN public.profiles p ON p.id = sr.profile_id
    WHERE p.auth_user_id = auth.uid() AND sr.status = 'active'
      AND sr.role = 'accountant'
  );
$$;

GRANT EXECUTE ON FUNCTION public.accessible_branch_ids()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.accessible_brand_ids()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_branch_access(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_access(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_accountant()                TO authenticated;

-- Phase 3 마이그레이션 4/6: 권한 헬퍼 함수
-- 참조: docs/01-db-schema.md §4

-- 4.1 has_role — 호출자가 특정 역할을 가지는가
CREATE OR REPLACE FUNCTION public.has_role(_role user_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE auth_user_id = auth.uid() AND role = _role
  );
$$;

-- 4.2 current_branch_id — 호출자의 소속 지점
CREATE OR REPLACE FUNCTION public.current_branch_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT branch_id FROM profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- 4.3 is_branch_member_of — 해당 회원이 호출자 지점 소속인가
CREATE OR REPLACE FUNCTION public.is_branch_member_of(_member_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m
    WHERE m.id = _member_id AND m.branch_id = current_branch_id()
  );
$$;

-- 4.4 is_coach_of — 호출자가 해당 회원의 담당 코치인가
CREATE OR REPLACE FUNCTION public.is_coach_of(_member_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m
    JOIN profiles p ON p.id = m.assigned_coach_id
    WHERE m.id = _member_id AND p.auth_user_id = auth.uid()
  );
$$;

-- 4.5 is_hq_admin — super_admin OR hq_admin
CREATE OR REPLACE FUNCTION public.is_hq_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role('super_admin') OR public.has_role('hq_admin');
$$;

-- 4.6 is_branch_admin — branch_owner OR branch_manager
CREATE OR REPLACE FUNCTION public.is_branch_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role('branch_owner') OR public.has_role('branch_manager');
$$;

-- 권한 부여
GRANT EXECUTE ON FUNCTION public.has_role(user_role)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_branch_id()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_branch_member_of(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_coach_of(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_hq_admin()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_branch_admin()           TO authenticated;

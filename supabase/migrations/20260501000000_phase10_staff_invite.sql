-- Phase 10 마이그레이션: 직원 목록 조회 RPC (auth.users.email 조인 필요)
-- profiles 자체로는 email 을 알 수 없음 — auth.users 와 조인해서 단일 응답.
-- hq 만 호출 가능.

CREATE OR REPLACE FUNCTION public.list_staff_profiles()
RETURNS TABLE (
  id uuid,
  auth_user_id uuid,
  role user_role,
  branch_id uuid,
  branch_name text,
  company_id uuid,
  name text,
  phone text,
  email text,
  status text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    p.id,
    p.auth_user_id,
    p.role,
    p.branch_id,
    b.name AS branch_name,
    p.company_id,
    p.name,
    p.phone,
    u.email::text AS email,
    p.status,
    p.created_at
  FROM profiles p
  LEFT JOIN branches b ON b.id = p.branch_id
  LEFT JOIN auth.users u ON u.id = p.auth_user_id
  WHERE public.is_hq_admin()
    AND p.role <> 'member'
  ORDER BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_staff_profiles() TO authenticated;

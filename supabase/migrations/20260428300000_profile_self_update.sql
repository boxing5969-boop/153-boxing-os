-- Phase 5.5 마이그레이션: profiles 자기 정보 수정 허용
-- 자기 row UPDATE 허용. role/branch_id/company_id/status 변경은 trigger 로 차단.

CREATE POLICY profiles_self_update ON profiles
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.profiles_self_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- hq 는 자유롭게 수정 가능
  IF public.is_hq_admin() THEN
    RETURN NEW;
  END IF;
  -- 자기 row 가 아니면 다른 정책에서 처리
  IF NEW.auth_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;
  -- self update — name/phone 외 변경 차단
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    RAISE EXCEPTION 'self update may only change name/phone';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER profiles_self_update_guard
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_self_update_guard();

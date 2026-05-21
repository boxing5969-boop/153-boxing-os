-- ============================================================
-- Fix: 지점 이동 시 brand_id/company_id 재유도
-- ============================================================
-- fill_tenancy_from_branch 가 BEFORE INSERT 에만 걸려 있어,
-- 회원/이용권의 branch_id 가 변경(지점 이동)되어도 brand_id·company_id 가
-- 옛 지점 값으로 남던 잠재 버그. UPDATE 경로를 추가해 재유도한다.
-- members/memberships 트리거를 BEFORE INSERT OR UPDATE 로 확장.
-- (payment/log/task 등 다른 테이블은 지점이 바뀌지 않으므로 INSERT 전용 유지)
-- ============================================================

CREATE OR REPLACE FUNCTION public.fill_tenancy_from_branch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_company uuid; v_brand uuid;
BEGIN
  IF NEW.branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.brand_id IS NULL OR NEW.company_id IS NULL THEN
      SELECT company_id, brand_id INTO v_company, v_brand
      FROM public.branches WHERE id = NEW.branch_id;
      IF NEW.company_id IS NULL THEN NEW.company_id := v_company; END IF;
      IF NEW.brand_id  IS NULL THEN NEW.brand_id  := v_brand;   END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    SELECT company_id, brand_id INTO v_company, v_brand
    FROM public.branches WHERE id = NEW.branch_id;
    NEW.company_id := v_company;
    NEW.brand_id   := v_brand;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_members_fill_tenancy
  BEFORE INSERT OR UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();
CREATE OR REPLACE TRIGGER trg_memberships_fill_tenancy
  BEFORE INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();

-- ============================================================
-- 멀티테넌트 1차-A: 테넌시 컬럼 표준화 + 자동채움 트리거
-- ============================================================
-- branches/members/memberships 에 brand_id·company_id·공통컬럼 추가.
-- 컬럼은 nullable 추가 → 백필 → NOT NULL 순으로 안전 적용.
-- 자동채움 트리거(fill_tenancy_from_branch)로 기존 INSERT 코드 무수정 호환.
-- ============================================================

-- ── branches.brand_id ───────────────────────────────────────
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS brand_id uuid;

UPDATE public.branches b
SET brand_id = (
  SELECT br.id FROM public.brands br
  WHERE br.company_id = b.company_id AND br.slug = 'default' LIMIT 1
)
WHERE brand_id IS NULL;

ALTER TABLE public.branches
  ALTER COLUMN brand_id SET NOT NULL,
  ADD CONSTRAINT fk_branches_brand
    FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_branches_brand ON public.branches(brand_id);

-- ── branches 공통 컬럼 ──────────────────────────────────────
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── members ─────────────────────────────────────────────────
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS brand_id   uuid,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.members m
SET brand_id = (SELECT b.brand_id FROM public.branches b WHERE b.id = m.branch_id)
WHERE brand_id IS NULL;

ALTER TABLE public.members
  ALTER COLUMN brand_id SET NOT NULL,
  ADD CONSTRAINT fk_members_brand
    FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_members_brand
  ON public.members(brand_id) WHERE deleted_at IS NULL;

-- ── memberships ─────────────────────────────────────────────
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS brand_id   uuid,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.memberships ms
SET company_id = b.company_id, brand_id = b.brand_id
FROM public.branches b
WHERE ms.branch_id = b.id AND (ms.company_id IS NULL OR ms.brand_id IS NULL);

ALTER TABLE public.memberships
  ALTER COLUMN company_id SET NOT NULL,
  ALTER COLUMN brand_id   SET NOT NULL,
  ADD CONSTRAINT fk_memberships_company
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_memberships_brand
    FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_memberships_company ON public.memberships(company_id);
CREATE INDEX IF NOT EXISTS idx_memberships_brand   ON public.memberships(brand_id);

-- ── profiles 공통 컬럼 ──────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── 자동채움 트리거: branch_id → company_id / brand_id ──────
-- 기존 회원/이용권 등록 코드가 brand_id·company_id 를 보내지 않아도
-- branch_id 만 있으면 자동으로 채워 NOT NULL 제약을 만족시킨다.
CREATE OR REPLACE FUNCTION public.fill_tenancy_from_branch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_company uuid; v_brand uuid;
BEGIN
  IF NEW.branch_id IS NOT NULL AND (NEW.brand_id IS NULL OR NEW.company_id IS NULL) THEN
    SELECT company_id, brand_id INTO v_company, v_brand
    FROM public.branches WHERE id = NEW.branch_id;
    IF NEW.company_id IS NULL THEN NEW.company_id := v_company; END IF;
    IF NEW.brand_id  IS NULL THEN NEW.brand_id  := v_brand;   END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_members_fill_tenancy
  BEFORE INSERT ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();
CREATE OR REPLACE TRIGGER trg_memberships_fill_tenancy
  BEFORE INSERT ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();

-- ── updated_at 자동 갱신 트리거 ─────────────────────────────
CREATE OR REPLACE TRIGGER trg_branches_updated_at
  BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_members_updated_at
  BEFORE UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_memberships_updated_at
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$ BEGIN
  RAISE NOTICE '테넌시 컬럼 + 자동채움/updated_at 트리거 완료';
END $$;

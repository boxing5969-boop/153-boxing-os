-- ============================================================
-- 멀티테넌트 1차-A: brands 계층 신설
-- ============================================================
-- 계층: companies(= organization) → brands → branches → members
-- companies 는 이름 유지(rename 없음). organization_id ≡ company_id.
-- 전부 추가형 — 기존 테이블/데이터/RLS 영향 없음.
-- ============================================================

-- ── current_company_id 헬퍼 (RLS용, 신규) ───────────────────
CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.current_company_id() TO authenticated;

-- ── set_updated_at 함수 보장 (이미 존재할 수 있음) ──────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ── brands 테이블 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brands (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  slug        text,
  status      text        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','inactive','archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  created_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_brands_company
  ON public.brands(company_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_brands_company_slug
  ON public.brands(company_id, slug) WHERE slug IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 백필: 회사마다 기본 브랜드 1개 ──────────────────────────
INSERT INTO public.brands (company_id, name, slug)
SELECT c.id, c.name || ' 기본 브랜드', 'default'
FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.company_id = c.id);

-- ── RLS (임시 정책 — Phase B 권한 재설계에서 정식화) ────────
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
GRANT ALL                    ON public.brands TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.brands TO authenticated;

CREATE POLICY brands_hq_all ON public.brands
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());

CREATE POLICY brands_company_select ON public.brands
  FOR SELECT TO authenticated
  USING (company_id = current_company_id());

DO $$ BEGIN
  RAISE NOTICE 'brands 테이블 + 기본 브랜드 백필 + current_company_id 헬퍼 완료';
END $$;

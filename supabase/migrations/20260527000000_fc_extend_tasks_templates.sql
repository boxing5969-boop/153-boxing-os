-- ============================================================
-- FC AI Care Center 1차-①: tasks · message_templates 확장
-- ============================================================
-- 요청된 fc_tasks / 새 message_templates 는 기존 동명/유사 테이블과
-- 중복되므로, 신규 생성 대신 기존 테이블을 확장한다(추가형).
-- ============================================================

-- ── tasks 확장 (FC 업무 카드용 컬럼) ────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS reason               text,
  ADD COLUMN IF NOT EXISTS recommended_action   text,
  ADD COLUMN IF NOT EXISTS recommended_message  text,
  ADD COLUMN IF NOT EXISTS expected_value       numeric(12,2),
  ADD COLUMN IF NOT EXISTS outcome              text;

-- task_type 값 확장 (기존 값 유지 + FC 유형 추가)
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_task_type_check
  CHECK (task_type IN (
    'renewal','unpaid','no_show','low_satisfaction','complaint','follow_up','other',
    'no_show_recovery','pt_conversion','praise','referral','onboarding'
  ));

-- ── message_templates 확장 (세그먼트·톤·테넌시) ─────────────
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS company_id      uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS brand_id        uuid REFERENCES public.brands(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS segment_key     text,
  ADD COLUMN IF NOT EXISTS product_type    text,
  ADD COLUMN IF NOT EXISTS lifecycle_stage text,
  ADD COLUMN IF NOT EXISTS tone            text
    CHECK (tone IN ('soft','friendly','motivational','professional')),
  ADD COLUMN IF NOT EXISTS variables       jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS deleted_at      timestamptz;

-- 기존 행 테넌시 백필 (branch 기준)
UPDATE public.message_templates mt
SET company_id = b.company_id, brand_id = b.brand_id
FROM public.branches b
WHERE mt.branch_id = b.id AND mt.company_id IS NULL;

-- 조직/브랜드 단위 템플릿을 위해 branch_id 를 nullable 로
ALTER TABLE public.message_templates ALTER COLUMN branch_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_templates_segment
  ON public.message_templates(company_id, segment_key) WHERE deleted_at IS NULL;

CREATE OR REPLACE TRIGGER trg_message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$ BEGIN
  RAISE NOTICE 'FC 1차-①: tasks · message_templates 확장 완료';
END $$;

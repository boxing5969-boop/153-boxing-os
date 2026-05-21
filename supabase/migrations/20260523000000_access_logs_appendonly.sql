-- ============================================================
-- 2차: access_logs append-only 강화 + 멱등성(idempotency)
-- ============================================================
-- access_logs 는 출입 감사 로그 → 수정/삭제 불가(append-only).
-- 같은 출입 이벤트가 여러 번 들어와도 idempotency_key 로 중복 방지.
-- 전부 추가형 — 기존 출입 조회/적재 코드 영향 없음(코드에 UPDATE/DELETE 없음 확인).
-- ============================================================

-- ── 컬럼 추가 ───────────────────────────────────────────────
ALTER TABLE public.access_logs
  ADD COLUMN IF NOT EXISTS company_id      uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brand_id        uuid REFERENCES public.brands(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS synced_at       timestamptz,
  ADD COLUMN IF NOT EXISTS raw_payload     jsonb;

-- ── 기존 행 테넌시 백필(현재 0건, 향후 안전장치) ────────────
UPDATE public.access_logs a
SET company_id = b.company_id, brand_id = b.brand_id
FROM public.branches b
WHERE a.branch_id = b.id AND a.company_id IS NULL;

-- ── 멱등성: 같은 idempotency_key 두 번 들어오면 거부 ────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_access_logs_idempotency
  ON public.access_logs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_access_logs_company
  ON public.access_logs(company_id, occurred_at DESC);

-- ── INSERT 시 branch_id → company_id/brand_id 자동 채움 ─────
-- fill_tenancy_from_branch() 는 1차에서 생성됨. access_logs 에도 부착.
CREATE OR REPLACE TRIGGER trg_access_logs_fill_tenancy
  BEFORE INSERT ON public.access_logs
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();

-- ── append-only 강제: UPDATE/DELETE 차단 ───────────────────
CREATE OR REPLACE FUNCTION public.block_modify()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only 테이블입니다: % 은(는) 수정/삭제할 수 없습니다', TG_TABLE_NAME;
END $$;

CREATE OR REPLACE TRIGGER trg_access_logs_append_only
  BEFORE UPDATE OR DELETE ON public.access_logs
  FOR EACH ROW EXECUTE FUNCTION public.block_modify();

DO $$ BEGIN
  RAISE NOTICE 'access_logs: 멱등성 + append-only 강제 완료';
END $$;

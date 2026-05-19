-- ============================================================
-- Phase 6: 체성분 측정 + 운동 일지 스키마
-- ============================================================

-- ── 1. 체성분 측정 기록 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.body_measurements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id      UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  branch_id      UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  measured_at    DATE NOT NULL DEFAULT CURRENT_DATE,
  weight_kg      NUMERIC(5,1),        -- 체중 (kg)
  body_fat_pct   NUMERIC(4,1),        -- 체지방률 (%)
  muscle_mass_kg NUMERIC(5,1),        -- 골격근량 (kg)
  bmi            NUMERIC(4,1),        -- BMI
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. 운동 일지 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workout_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  branch_id    UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  coach_id     UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  logged_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  duration_min INT,
  intensity    TEXT CHECK (intensity IN ('light', 'moderate', 'intense')),
  note         TEXT,                  -- 운동 내용/특이사항 자유 메모
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 인덱스 ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_body_measurements_member
  ON public.body_measurements(member_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_workout_logs_member
  ON public.workout_logs(member_id, logged_date DESC);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.body_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_logs      ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.body_measurements TO service_role;
GRANT ALL ON public.workout_logs      TO service_role;
GRANT SELECT ON public.body_measurements TO authenticated;
GRANT SELECT ON public.workout_logs      TO authenticated;

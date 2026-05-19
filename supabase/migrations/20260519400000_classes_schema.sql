-- ============================================================
-- Phase 4: 수업 / PT 관리 스키마
-- ============================================================

-- ── 1. 수업 유형 ─────────────────────────────────────────────
-- class_type: group(그룹), pt(개인 PT), open(자유 훈련)
CREATE TABLE IF NOT EXISTS public.classes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  coach_id      UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,                          -- 예: "복싱 기초반", "PT 세션"
  class_type    TEXT NOT NULL DEFAULT 'group'           -- group | pt | open
                  CHECK (class_type IN ('group','pt','open')),
  capacity      INT  NOT NULL DEFAULT 10,               -- 최대 정원 (pt=1)
  duration_min  INT  NOT NULL DEFAULT 60,               -- 수업 시간(분)
  description   TEXT,
  color         TEXT DEFAULT '#3b82f6',                 -- 달력 표시 색
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. 수업 일정 (반복 스케줄) ───────────────────────────────
-- 매주 월·수·금 7pm 처럼 반복 설정
CREATE TABLE IF NOT EXISTS public.class_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  branch_id     UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  day_of_week   INT  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=일, 1=월 … 6=토
  start_time    TIME NOT NULL,                          -- 예: '19:00'
  repeat_until  DATE,                                   -- NULL이면 무기한
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. 수업 세션 (실제 날짜별 인스턴스) ─────────────────────
-- 스케줄 or 일회성으로 생성
CREATE TABLE IF NOT EXISTS public.class_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id      UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  schedule_id   UUID REFERENCES public.class_schedules(id) ON DELETE SET NULL,
  branch_id     UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  coach_id      UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  session_date  DATE NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  capacity      INT  NOT NULL DEFAULT 10,
  status        TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','in_progress','completed','canceled')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, session_date, start_time)
);

-- ── 4. 수업 예약 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.class_bookings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES public.class_sessions(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  branch_id     UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'booked'
                  CHECK (status IN ('booked','attended','no_show','canceled')),
  booked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_in_at TIMESTAMPTZ,
  note          TEXT,
  UNIQUE (session_id, member_id)
);

-- ── 5. PT 세션 (개별 PT 예약 / 횟수권 차감) ─────────────────
CREATE TABLE IF NOT EXISTS public.pt_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  coach_id        UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  branch_id       UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  membership_id   UUID REFERENCES public.memberships(id) ON DELETE SET NULL, -- 연결된 횟수권
  session_date    DATE NOT NULL,
  start_time      TIME NOT NULL,
  duration_min    INT  NOT NULL DEFAULT 60,
  status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','completed','no_show','canceled')),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 인덱스 ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_classes_branch        ON public.classes(branch_id);
CREATE INDEX IF NOT EXISTS idx_class_sessions_date   ON public.class_sessions(branch_id, session_date);
CREATE INDEX IF NOT EXISTS idx_class_bookings_member ON public.class_bookings(member_id);
CREATE INDEX IF NOT EXISTS idx_class_bookings_session ON public.class_bookings(session_id);
CREATE INDEX IF NOT EXISTS idx_pt_sessions_member    ON public.pt_sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_pt_sessions_coach     ON public.pt_sessions(coach_id);
CREATE INDEX IF NOT EXISTS idx_pt_sessions_date      ON public.pt_sessions(branch_id, session_date);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.classes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_schedules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_bookings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pt_sessions      ENABLE ROW LEVEL SECURITY;

-- service_role 전체 접근
GRANT ALL ON public.classes          TO service_role;
GRANT ALL ON public.class_schedules  TO service_role;
GRANT ALL ON public.class_sessions   TO service_role;
GRANT ALL ON public.class_bookings   TO service_role;
GRANT ALL ON public.pt_sessions      TO service_role;

-- authenticated 읽기 (Workers 통해서만 쓰기)
GRANT SELECT ON public.classes          TO authenticated;
GRANT SELECT ON public.class_schedules  TO authenticated;
GRANT SELECT ON public.class_sessions   TO authenticated;
GRANT SELECT ON public.class_bookings   TO authenticated;
GRANT SELECT ON public.pt_sessions      TO authenticated;

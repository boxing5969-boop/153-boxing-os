-- ============================================================
-- 일일 경영 성과 리포트 (신규 3테이블 — 기존 14테이블 스키마 불변)
--   monthly_targets / daily_reports / daily_checklists
-- 접근: 모든 읽기/쓰기는 Workers API(service_role) 경유. RLS 활성(클라 직접 접근 차단).
-- ============================================================

-- 1) 월 목표 매출
CREATE TABLE IF NOT EXISTS public.monthly_targets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  year          int         NOT NULL,
  month         int         NOT NULL CHECK (month BETWEEN 1 AND 12),
  target_amount bigint      NOT NULL DEFAULT 0 CHECK (target_amount >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, year, month)
);
CREATE INDEX IF NOT EXISTS monthly_targets_branch_idx ON public.monthly_targets (branch_id, year, month);
ALTER TABLE public.monthly_targets ENABLE ROW LEVEL SECURITY;

-- 2) 일일 성과 리포트 (지점별 하루 1건)
CREATE TABLE IF NOT EXISTS public.daily_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id          uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  report_date        date NOT NULL,
  author_profile_id  uuid REFERENCES public.profiles(id),
  revenue_pt         bigint NOT NULL DEFAULT 0 CHECK (revenue_pt >= 0),
  revenue_membership bigint NOT NULL DEFAULT 0 CHECK (revenue_membership >= 0),
  revenue_goods      bigint NOT NULL DEFAULT 0 CHECK (revenue_goods >= 0),
  revenue_dan        bigint NOT NULL DEFAULT 0 CHECK (revenue_dan >= 0),
  inquiry_count        int NOT NULL DEFAULT 0,
  new_signups          int NOT NULL DEFAULT 0,
  re_signups           int NOT NULL DEFAULT 0,
  pending_count        int NOT NULL DEFAULT 0,
  pipeline_action_plan text,
  morning_attendance int NOT NULL DEFAULT 0,
  lunch_attendance   int NOT NULL DEFAULT 0,
  evening_attendance int NOT NULL DEFAULT 0,
  morning_note text, lunch_note text, evening_note text,
  inactive_contacted   int NOT NULL DEFAULT 0,
  inactive_reached     int NOT NULL DEFAULT 0,
  inactive_returned    int NOT NULL DEFAULT 0,
  promotion_candidates text,
  facility_issue       text,
  decision_issue    text,
  decision_proposal text,
  decision_request  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, report_date)
);
CREATE INDEX IF NOT EXISTS daily_reports_branch_date_idx ON public.daily_reports (branch_id, report_date DESC);
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;

-- 3) 일일 오픈 체크리스트 (지점별 하루 1건)
CREATE TABLE IF NOT EXISTS public.daily_checklists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  items       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{no,label,done,memo}]
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, report_date)
);
CREATE INDEX IF NOT EXISTS daily_checklists_branch_date_idx ON public.daily_checklists (branch_id, report_date DESC);
ALTER TABLE public.daily_checklists ENABLE ROW LEVEL SECURITY;

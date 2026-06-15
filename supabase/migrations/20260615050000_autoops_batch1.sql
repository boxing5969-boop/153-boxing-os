-- ============================================================
-- 오토매장 운영 Batch 1 — 신규 8테이블
-- operation_tasks / operation_alerts / lead_inquiries / member_snapshots
-- import_jobs / issue_tickets / ops_message_logs / branch_daily_scores
-- 기존 테이블 불변. RLS 활성 + service_role GRANT + set_updated_at 트리거.
-- generated_key UNIQUE 로 자동 생성 멱등(분기: NULL은 distinct → 수동 항목 허용).
-- ============================================================

-- 1) operation_tasks — 오늘의 업무(자동/수동)
CREATE TABLE IF NOT EXISTS public.operation_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  task_date     date NOT NULL,
  category      text NOT NULL,            -- open/close/sales/followup/member_care/lead/refund/facility/report/pt/inventory/admin
  priority      text NOT NULL DEFAULT 'normal',  -- low/normal/high/urgent
  status        text NOT NULL DEFAULT 'pending', -- pending/in_progress/done/skipped/postponed/canceled
  title         text NOT NULL,
  description   text,
  action_label  text,
  source_type   text,                     -- daily_report/checklist/followup/sale/pt_pass/refund/lead/member_snapshot/issue_ticket/manual
  source_id     uuid,
  generated_key text,
  member_name   text,
  member_phone  text,
  assigned_to   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_at        timestamptz,
  completed_at  timestamptz,
  completed_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  skipped_reason text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operation_tasks_genkey UNIQUE (branch_id, task_date, generated_key)
);
CREATE INDEX IF NOT EXISTS operation_tasks_branch_date_idx ON public.operation_tasks (branch_id, task_date DESC);
CREATE INDEX IF NOT EXISTS operation_tasks_branch_status_idx ON public.operation_tasks (branch_id, status);
CREATE INDEX IF NOT EXISTS operation_tasks_branch_pri_idx ON public.operation_tasks (branch_id, priority);
CREATE INDEX IF NOT EXISTS operation_tasks_due_idx ON public.operation_tasks (due_at);

-- 2) operation_alerts — 자동 경고
CREATE TABLE IF NOT EXISTS public.operation_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  alert_date    date NOT NULL,
  severity      text NOT NULL DEFAULT 'warning',  -- info/warning/danger/critical
  category      text NOT NULL,                    -- sales/report/followup/refund/facility/member/lead/checklist/system
  status        text NOT NULL DEFAULT 'open',     -- open/acknowledged/resolved/dismissed
  title         text NOT NULL,
  message       text NOT NULL,
  source_type   text,
  source_id     uuid,
  generated_key text,
  score_impact  integer NOT NULL DEFAULT 0,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  resolved_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operation_alerts_genkey UNIQUE (branch_id, alert_date, generated_key)
);
CREATE INDEX IF NOT EXISTS operation_alerts_branch_date_idx ON public.operation_alerts (branch_id, alert_date DESC);
CREATE INDEX IF NOT EXISTS operation_alerts_branch_status_idx ON public.operation_alerts (branch_id, status);

-- 3) lead_inquiries — 문의/체험 CRM
CREATE TABLE IF NOT EXISTS public.lead_inquiries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  lead_name       text NOT NULL,
  phone           text,
  source          text,            -- naver/instagram/referral/signboard/carrot/walk_in/etc
  interest_product text,
  status          text NOT NULL DEFAULT 'inquiry',  -- inquiry/contacted/trial_booked/trial_done/registered/hold/failed
  first_contact_at timestamptz,
  trial_at        timestamptz,
  next_action_at  timestamptz,
  assigned_to     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  memo            text,
  result_reason   text,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_inquiries_branch_status_idx ON public.lead_inquiries (branch_id, status);
CREATE INDEX IF NOT EXISTS lead_inquiries_next_action_idx ON public.lead_inquiries (next_action_at);
CREATE INDEX IF NOT EXISTS lead_inquiries_phone_idx ON public.lead_inquiries (phone);

-- 4) member_snapshots — 브로제이/수동 회원 스냅샷
CREATE TABLE IF NOT EXISTS public.member_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_name      text NOT NULL,
  phone            text,
  normalized_phone text GENERATED ALWAYS AS (regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g')) STORED,
  product_name     text,
  membership_type  text,           -- period/sessions/mixed/unknown
  start_date       date,
  end_date         date,
  total_sessions   integer,
  used_sessions    integer,
  remaining_sessions integer,
  latest_visit_date date,
  payment_amount   integer,
  payment_method   text,
  assigned_coach   text,
  status           text,           -- active/expiring/expired/paused/unknown
  source           text,           -- broj_csv/manual/sales_entry
  import_job_id    uuid,
  raw_payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS member_snapshots_phone_uniq
  ON public.member_snapshots (branch_id, normalized_phone) WHERE normalized_phone <> '';
CREATE INDEX IF NOT EXISTS member_snapshots_branch_idx ON public.member_snapshots (branch_id, status);
CREATE INDEX IF NOT EXISTS member_snapshots_end_idx ON public.member_snapshots (branch_id, end_date);
CREATE INDEX IF NOT EXISTS member_snapshots_visit_idx ON public.member_snapshots (branch_id, latest_visit_date);

-- 5) import_jobs — CSV 가져오기 기록
CREATE TABLE IF NOT EXISTS public.import_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  import_type   text NOT NULL,     -- broj_members/broj_expiring/broj_attendance
  file_name     text,
  status        text NOT NULL DEFAULT 'pending',  -- pending/parsed/imported/failed
  total_rows    integer NOT NULL DEFAULT 0,
  imported_rows integer NOT NULL DEFAULT 0,
  failed_rows   integer NOT NULL DEFAULT 0,
  mapping       jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS import_jobs_branch_idx ON public.import_jobs (branch_id, created_at DESC);

-- 6) issue_tickets — 시설/장비 이슈
CREATE TABLE IF NOT EXISTS public.issue_tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  title         text NOT NULL,
  category      text NOT NULL,     -- facility/equipment/cleaning/air_conditioning/cctv/payment_device/locker/uniform/etc
  severity      text NOT NULL DEFAULT 'normal',  -- low/normal/high/urgent
  status        text NOT NULL DEFAULT 'open',    -- open/in_progress/waiting_vendor/done/canceled
  location      text,
  description   text,
  photo_url     text,
  assigned_to   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_at        timestamptz,
  cost_amount   integer NOT NULL DEFAULT 0,
  vendor_name   text,
  completed_at  timestamptz,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS issue_tickets_branch_status_idx ON public.issue_tickets (branch_id, status);
CREATE INDEX IF NOT EXISTS issue_tickets_due_idx ON public.issue_tickets (due_at);

-- 7) ops_message_logs — 문구 생성/복사 로그
CREATE TABLE IF NOT EXISTS public.ops_message_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  recipient_name text,
  phone         text,
  template_type text NOT NULL,
  related_type  text,
  related_id    uuid,
  content       text NOT NULL,
  status        text NOT NULL DEFAULT 'generated',  -- generated/copied/sent_external/canceled
  copied_at     timestamptz,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_message_logs_branch_idx ON public.ops_message_logs (branch_id, created_at DESC);

-- 8) branch_daily_scores — 지점 일일 운영 점수
CREATE TABLE IF NOT EXISTS public.branch_daily_scores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  score_date    date NOT NULL,
  total_score   integer NOT NULL DEFAULT 0,
  report_score  integer NOT NULL DEFAULT 0,
  sales_score   integer NOT NULL DEFAULT 0,
  task_score    integer NOT NULL DEFAULT 0,
  followup_score integer NOT NULL DEFAULT 0,
  lead_score    integer NOT NULL DEFAULT 0,
  checklist_score integer NOT NULL DEFAULT 0,
  refund_score  integer NOT NULL DEFAULT 0,
  facility_score integer NOT NULL DEFAULT 0,
  grade         text,             -- safe/watch/danger
  summary       text,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_daily_scores_uniq UNIQUE (branch_id, score_date)
);
CREATE INDEX IF NOT EXISTS branch_daily_scores_branch_idx ON public.branch_daily_scores (branch_id, score_date DESC);

-- ── updated_at 트리거 (기존 set_updated_at 재사용) ──
CREATE OR REPLACE TRIGGER trg_operation_tasks_updated   BEFORE UPDATE ON public.operation_tasks   FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_operation_alerts_updated  BEFORE UPDATE ON public.operation_alerts  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_lead_inquiries_updated    BEFORE UPDATE ON public.lead_inquiries    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_member_snapshots_updated  BEFORE UPDATE ON public.member_snapshots  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_issue_tickets_updated     BEFORE UPDATE ON public.issue_tickets     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_branch_daily_scores_updated BEFORE UPDATE ON public.branch_daily_scores FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS 활성 (정책 없음 → service_role 만 접근) ──
ALTER TABLE public.operation_tasks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_alerts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_inquiries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_tickets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_message_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_daily_scores ENABLE ROW LEVEL SECURITY;

-- ── service_role GRANT (필수 — 워커 쓰기) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.operation_tasks, public.operation_alerts, public.lead_inquiries,
  public.member_snapshots, public.import_jobs, public.issue_tickets,
  public.ops_message_logs, public.branch_daily_scores
TO service_role;

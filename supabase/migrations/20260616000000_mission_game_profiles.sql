-- 미션 게임화 영속 (Batch 2) — 신규 4테이블. 기존 테이블 불변. RLS + service_role GRANT.
CREATE TABLE IF NOT EXISTS public.game_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  domain text NOT NULL,
  owner_type text NOT NULL DEFAULT 'branch',
  owner_id uuid,
  owner_key text GENERATED ALWAYS AS (COALESCE(owner_id::text, '')) STORED,
  total_xp integer NOT NULL DEFAULT 0,
  level integer NOT NULL DEFAULT 1,
  current_streak integer NOT NULL DEFAULT 0,
  best_streak integer NOT NULL DEFAULT 0,
  streak_freezes integer NOT NULL DEFAULT 1,
  last_success_date date,
  hp integer NOT NULL DEFAULT 100,
  badges jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS game_profiles_uniq ON public.game_profiles (branch_id, domain, owner_type, owner_key);
CREATE INDEX IF NOT EXISTS game_profiles_branch_idx ON public.game_profiles (branch_id, domain);

CREATE TABLE IF NOT EXISTS public.reward_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  domain text NOT NULL,
  owner_type text NOT NULL DEFAULT 'branch',
  owner_id uuid,
  user_id uuid,
  event_date date NOT NULL,
  reward_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  xp_bonus integer NOT NULL DEFAULT 0,
  hp_bonus integer NOT NULL DEFAULT 0,
  related_task_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reward_events_branch_idx ON public.reward_events (branch_id, domain, event_date DESC);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  domain text NOT NULL,
  center_type text,
  user_id uuid,
  activity_date date NOT NULL,
  activity_type text NOT NULL,
  related_type text,
  related_id uuid,
  customer_name text,
  phone text,
  result text,
  amount integer NOT NULL DEFAULT 0,
  memo text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_logs_branch_idx ON public.activity_logs (branch_id, domain, activity_date DESC);

CREATE TABLE IF NOT EXISTS public.nudge_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  domain text NOT NULL,
  user_id uuid,
  nudge_date date NOT NULL,
  nudge_type text NOT NULL,
  message text NOT NULL,
  related_task_id uuid,
  status text NOT NULL DEFAULT 'shown',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nudge_logs_branch_idx ON public.nudge_logs (branch_id, domain, nudge_date DESC);

CREATE OR REPLACE TRIGGER trg_game_profiles_updated BEFORE UPDATE ON public.game_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.game_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nudge_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_profiles, public.reward_events, public.activity_logs, public.nudge_logs TO service_role;

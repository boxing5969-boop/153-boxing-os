-- 회원 의견·칭찬 수집 시스템 (키오스크 QR → 공개 페이지 → 제출 → 직원 보드)
-- 접근 모델: 모든 읽기/쓰기는 Workers(service_role) 경유. RLS 활성 + 정책 없음.
-- 개인정보: 연락처는 '추첨 참여 동의' 시에만 저장하고, 추첨 후 파기(contact_purged_at) 대상.

-- 1) 지점별 공개 채널 (QR 슬러그) --------------------------------------------
create table if not exists public.member_feedback_channels (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  company_id uuid,
  brand_id uuid,
  slug text not null unique,        -- 공개 URL 식별자(내부 UUID 비노출·교체 가능)
  title text,                       -- 페이지 상단 문구(선택)
  prize_text text,                  -- 이번 이벤트 경품 표기
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_mfc_branch on public.member_feedback_channels(branch_id);

-- 2) 회원 의견 ---------------------------------------------------------------
create table if not exists public.member_feedback (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  company_id uuid,
  brand_id uuid,
  channel_id uuid references public.member_feedback_channels(id) on delete set null,
  category text not null check (category in ('improvement','coach_praise','complaint','free')),
  rating smallint check (rating between 1 and 5),
  content text not null check (char_length(btrim(content)) between 2 and 2000),
  coach_name text,                  -- 코치 칭찬 대상(회원이 적는 이름)
  -- 추첨용 연락처(선택) — 동의 시에만
  draw_opt_in boolean not null default false,
  contact_name text,
  contact_phone text,
  draw_month date,                  -- 응모 월(해당 월 1일)
  privacy_agreed_at timestamptz,    -- 개인정보 수집·이용 동의 시각
  contact_purged_at timestamptz,    -- 연락처 파기 시각
  status text not null default 'new' check (status in ('new','reviewing','resolved','dismissed')),
  staff_note text,
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  submitted_ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_mf_branch_created  on public.member_feedback(branch_id, created_at desc);
create index if not exists idx_mf_branch_status   on public.member_feedback(branch_id, status);
create index if not exists idx_mf_branch_category on public.member_feedback(branch_id, category);
create index if not exists idx_mf_draw            on public.member_feedback(branch_id, draw_month) where draw_opt_in;
create index if not exists idx_mf_ip_created      on public.member_feedback(submitted_ip, created_at desc);
-- 한 번호는 지점·월 1회만 응모(중복 응모 방지). 워커가 사전 확인해 안내하고, 이 인덱스는 최종 안전망.
create unique index if not exists uq_mf_draw_phone_month
  on public.member_feedback(branch_id, contact_phone, draw_month)
  where draw_opt_in and contact_phone is not null and contact_purged_at is null;

-- 3) 매달 추첨 기록 -----------------------------------------------------------
create table if not exists public.member_feedback_draws (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  company_id uuid,
  brand_id uuid,
  draw_month date not null,
  feedback_id uuid references public.member_feedback(id) on delete set null,
  winner_name text,
  winner_phone text,
  prize_text text,
  entry_count integer not null default 0,
  drawn_by uuid references public.profiles(id) on delete set null,
  drawn_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_mfd_branch_month on public.member_feedback_draws(branch_id, draw_month);

-- 트리거 ---------------------------------------------------------------------
create or replace trigger trg_mfc_updated before update on public.member_feedback_channels
  for each row execute function public.set_updated_at();
create or replace trigger trg_mf_updated before update on public.member_feedback
  for each row execute function public.set_updated_at();
create or replace trigger trg_mfd_updated before update on public.member_feedback_draws
  for each row execute function public.set_updated_at();

create or replace trigger trg_mfc_tenancy before insert on public.member_feedback_channels
  for each row execute function public.fill_tenancy_from_branch();
create or replace trigger trg_mf_tenancy before insert on public.member_feedback
  for each row execute function public.fill_tenancy_from_branch();
create or replace trigger trg_mfd_tenancy before insert on public.member_feedback_draws
  for each row execute function public.fill_tenancy_from_branch();

-- RLS: 활성 + 정책 없음 → service_role(워커)만 접근 -----------------------------
alter table public.member_feedback_channels enable row level security;
alter table public.member_feedback          enable row level security;
alter table public.member_feedback_draws    enable row level security;

grant select, insert, update, delete on public.member_feedback_channels to service_role;
grant select, insert, update, delete on public.member_feedback          to service_role;
grant select, insert, update, delete on public.member_feedback_draws    to service_role;

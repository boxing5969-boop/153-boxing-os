-- 153 FC V6 AutoCRM — 재등록 확률·원클릭·상품·자동발송 상태머신
-- 신규: fc_products · fc_automation_config · fc_send_state(dedup) · fc_events
-- 확장: member_care_profiles (renewal 스칼라 필터 — 큐 정렬/필터용; v5 jsonb는 renewal_* 키 추가로 흡수)
-- 정책: 기존과 동일 — RLS on(공개정책 없음=deny) + service_role 전권(워커 접근). branch_id 스코프.

-- 1) 상품 카탈로그(지점별)
create table if not exists public.fc_products (
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_key text not null,
  name text not null,
  months integer,
  price bigint,
  payment_url text default '',
  active boolean not null default false,
  gift_key text default 'NONE',
  target text,
  sort integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (branch_id, product_key)
);

-- 2) 자동화 설정(지점별 1행)
create table if not exists public.fc_automation_config (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  branch_phone text default '',
  free_optout text default '',
  consult_url text default '',
  coupon_asset_url text default '',
  payment_base_url text default '',
  webhook_url text default '',
  kakao_channel_id text default '',
  dry_run boolean not null default true,
  auto_send_enabled boolean not null default false,
  high_threshold numeric not null default 0.72,
  medium_threshold numeric not null default 0.45,
  max_ad_contacts_30d integer not null default 3,
  min_contact_gap_days integer not null default 3,
  send_hour integer not null default 10,
  send_minute integer not null default 30,
  updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3) 발송 상태(중복방지 dedup + 중단)
create table if not exists public.fc_send_state (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  dedup_key text not null,
  member_id text,
  normalized_phone text,
  rule_id text,
  template_key text,
  status text not null default 'queued', -- queued / sent / stopped
  stop_reason text,                       -- payment_success / consult_requested / pause_requested / optout / service_issue
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (branch_id, dedup_key)
);

-- 4) 이벤트 로그(발송/클릭/중단 콜백)
create table if not exists public.fc_events (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  member_id text,
  normalized_phone text,
  dedup_key text,
  event_type text not null,
  detail jsonb default '{}'::jsonb,
  occurred_at timestamptz default now(),
  created_at timestamptz default now()
);

-- 5) member_care_profiles 재등록 스칼라(필터/정렬용; 추가만)
alter table public.member_care_profiles add column if not exists renewal_probability numeric;
alter table public.member_care_profiles add column if not exists renewal_band text;
alter table public.member_care_profiles add column if not exists renewal_rule_id text;
alter table public.member_care_profiles add column if not exists days_to_expiry integer;

-- 인덱스
create index if not exists idx_fc_products_branch on public.fc_products(branch_id, active);
create index if not exists idx_fc_send_state_branch on public.fc_send_state(branch_id, status);
create index if not exists idx_fc_send_state_dedup on public.fc_send_state(branch_id, dedup_key);
create index if not exists idx_fc_events_branch on public.fc_events(branch_id, event_type);
create index if not exists idx_mcp_v6_renewal on public.member_care_profiles(branch_id, renewal_probability);
create index if not exists idx_mcp_v6_expiry on public.member_care_profiles(branch_id, days_to_expiry);

-- RLS on(공개정책 없음=deny) + service_role 전권
alter table public.fc_products enable row level security;
alter table public.fc_automation_config enable row level security;
alter table public.fc_send_state enable row level security;
alter table public.fc_events enable row level security;
grant all on public.fc_products to service_role;
grant all on public.fc_automation_config to service_role;
grant all on public.fc_send_state to service_role;
grant all on public.fc_events to service_role;

-- 153 FC V5 Lifecycle·VIP·Winback — Phase 2 DB 확장
-- 신규: fc_gift_catalog · fc_member_inputs · fc_benefit_ledger · fc_referral_log
-- 확장: member_care_profiles (v5 jsonb + 필터 스칼라)
-- 정책: 기존 member_care_* 와 동일 — RLS on(공개 정책 없음=deny) + service_role 전권(워커 접근)
-- 기존 데이터/컬럼 보존(추가만).

-- ── 1. 기프트 카탈로그 ──
create table if not exists public.fc_gift_catalog (
  gift_key text primary key,
  name text not null,
  gift_type text,
  recommended_tier text,
  unit_cost integer not null default 0,
  perceived_value integer default 0,
  valid_days integer default 0,
  condition text,
  active boolean not null default true,
  annual_personal_limit integer default 1,
  tracking text default '필수',
  memo text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 2. FC 수기 입력 (branch_id, normalized_phone 키 — members/member_snapshots 분리 우회) ──
create table if not exists public.fc_member_inputs (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  normalized_phone text not null,
  member_name text,
  -- 서비스/동의 게이트
  satisfaction numeric,
  complaint boolean default false,
  payment_issue boolean default false,
  ad_consent boolean default false,
  opt_out boolean default false,
  do_not_contact boolean default false,
  -- 목표/장벽/출석(수기 보정)
  goal text,
  barrier text,
  target_visits_per_week numeric,
  visits_7d integer, visits_14d integer, visits_30d integer, visits_90d integer, previous_30d_visits integer,
  first_join_date date,
  -- 매출(수기 보정; 없으면 스냅샷 결제금액 사용)
  membership_revenue bigint, pt_revenue bigint, other_revenue bigint, refund bigint,
  -- 소개/관계
  referral_inquiries integer default 0, referral_registrations integer default 0, referral_revenue bigint default 0,
  reviews integer default 0, community_contribution numeric default 0,
  -- VIP/기프트
  gift_cost_365d integer default 0, last_vip_care_date date, manual_vip_tier text, preferred_gift_key text,
  -- 종료/복귀
  end_reason text, return_interest text, return_declined boolean default false,
  recontact_date date, last_post_end_contact_date date, post_end_sales_contacts_90d integer default 0,
  updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(branch_id, normalized_phone)
);

-- ── 3. 기프트 원장 ──
create table if not exists public.fc_benefit_ledger (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  normalized_phone text,
  member_name text,
  gift_key text references public.fc_gift_catalog(gift_key),
  status text not null default '지급',          -- 지급/사용/만료/취소
  unit_cost integer default 0,
  issued_at date default current_date,
  used_at date,
  expires_at date,
  approved_by uuid,
  attributed_referral integer default 0,
  attributed_revenue bigint default 0,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 4. 소개 추적 ──
create table if not exists public.fc_referral_log (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  referrer_phone text,
  referrer_name text,
  invitee_name text,
  invitee_phone text,                            -- 동의 후에만 저장
  stage text not null default '문의',             -- 문의/체험/등록/30일유지
  attributed_revenue bigint default 0,
  consent_collected boolean default false,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── 5. member_care_profiles 확장 ──
alter table public.member_care_profiles
  add column if not exists v5 jsonb,
  add column if not exists vip_tier text,
  add column if not exists winback_cohort text,
  add column if not exists send_gate text;

-- ── 6. 인덱스 ──
create index if not exists idx_fc_member_inputs_branch on public.fc_member_inputs(branch_id);
create index if not exists idx_fc_benefit_ledger_branch on public.fc_benefit_ledger(branch_id, status);
create index if not exists idx_fc_referral_log_branch on public.fc_referral_log(branch_id, stage);
create index if not exists idx_mcp_v5_tier on public.member_care_profiles(branch_id, vip_tier);
create index if not exists idx_mcp_v5_cohort on public.member_care_profiles(branch_id, winback_cohort);

-- ── 7. RLS + 권한 (기존 member_care_* 와 동일 패턴) ──
alter table public.fc_gift_catalog enable row level security;
alter table public.fc_member_inputs enable row level security;
alter table public.fc_benefit_ledger enable row level security;
alter table public.fc_referral_log enable row level security;
grant all on public.fc_gift_catalog to service_role;
grant all on public.fc_member_inputs to service_role;
grant all on public.fc_benefit_ledger to service_role;
grant all on public.fc_referral_log to service_role;

-- ── 8. 기프트 카탈로그 시드(11종; 활성 Y만 active=true, '검토'는 false) ──
insert into public.fc_gift_catalog (gift_key,name,gift_type,recommended_tier,unit_cost,perceived_value,valid_days,condition,active,annual_personal_limit,tracking,memo) values
 ('GUEST1','게스트 1회 초대권','게스트','SILVER 이상',10000,30000,30,'VIP 서비스 게이트 통과·예산잔액 확인',true,2,'필수','초대받는 분 연락처는 별도 동의 후 수집'),
 ('GUEST2','게스트 2회 초대권','게스트','BLACK·AMBASSADOR',20000,60000,30,'VIP 서비스 게이트 통과·예산잔액 확인',true,2,'필수','한 번에 2명 또는 2회 사용 가능 여부는 센터 기준'),
 ('COACH15','코치 기술점검 15분','서비스','GOLD 이상',0,25000,30,'코치 스케줄 확인 후 예약',true,2,'필수','개인레슨으로 오인되지 않도록 제공 범위 명시'),
 ('GOAL20','운동목표 리셋 상담 20분','서비스','SILVER 이상',0,20000,30,'FC 또는 코치 일정 확정',true,2,'필수','다음 30일 출석계획까지 확정'),
 ('ANNIV','등록기념 감사카드·메시지','관계','장기회원',3000,15000,14,'등록기념일 전후 제공',true,1,'선택','개인화된 성과·감사 내용 포함'),
 ('EVENT','특별수업 우선초대','경험','GOLD 이상',0,30000,30,'실제 특별수업이 있을 때만',false,4,'필수','허위 이벤트 금지'),
 ('LOCKER30','락커 30일 이용','편의','BLACK 이상',5000,20000,30,'여유 락커 확인',false,1,'필수','재고·운영 가능 여부 확인'),
 ('WRAP','핸드랩 기프트','상품','BLACK·AMBASSADOR',12000,25000,0,'재고·사이즈·예산 승인',false,1,'필수','실제 원가로 수정'),
 ('TOWEL','짐 타월·소형 굿즈','상품','AMBASSADOR',15000,30000,0,'재고·예산 승인',false,1,'필수','실제 제작 후 활성화'),
 ('PHOTO','트레이닝 사진·기록','콘텐츠','관계기여형',0,15000,14,'촬영·활용 동의 확인',false,2,'필수','SNS 게시 동의는 별도'),
 ('NONE','기프트 없음·감사 케어만','관계','전체',0,0,0,'예산·게이트 미충족 시',true,99,'선택','기프트보다 대화와 서비스 회복이 우선')
on conflict (gift_key) do nothing;

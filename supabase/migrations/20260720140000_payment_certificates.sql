-- 결제확인서 발급 (지점 → 회원 문자 링크 → 공개 페이지에서 이미지 확인·저장)
-- 접근 모델: 발급·목록·회수 = 워커(service_role) 경유. 공개 조회 = 워커가 슬러그로 조회(무추측 12hex).
-- RLS 활성 + 정책 없음(service_role 전용).
create table if not exists public.payment_certificates (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  company_id uuid,
  brand_id uuid,
  slug text not null unique,                 -- 공개 링크 식별자(내부 UUID 비노출)
  cert_no text not null,                     -- 표기용 발급번호 153-YYYYMMDD-XXXXXX
  member_name text not null,
  member_phone text,                         -- 발송용(공개 페이지엔 미노출)
  product_name text not null,
  amount integer not null check (amount >= 0),
  payment_method text,                       -- 카드/현금/계좌이체 등
  paid_date date,                            -- 결제일
  period_start date,
  period_end date,
  purpose text,                              -- 용도(회사 제출용 등, 선택)
  issued_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,                    -- 회수 시 공개 링크 404
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pc_branch_created on public.payment_certificates(branch_id, created_at desc);

create or replace trigger trg_pc_updated before update on public.payment_certificates
  for each row execute function public.set_updated_at();
create or replace trigger trg_pc_tenancy before insert on public.payment_certificates
  for each row execute function public.fill_tenancy_from_branch();

alter table public.payment_certificates enable row level security;
grant select, insert, update, delete on public.payment_certificates to service_role;

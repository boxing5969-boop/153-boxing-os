-- 지점별 결산 시작일(회계 월 시작). 기본 1일 = 달력 월. 역삼점은 13일~다음달 12일.
alter table public.branches add column if not exists fiscal_start_day smallint not null default 1;
alter table public.branches drop constraint if exists branches_fiscal_start_day_chk;
alter table public.branches add constraint branches_fiscal_start_day_chk check (fiscal_start_day between 1 and 28);
comment on column public.branches.fiscal_start_day is '결산 월 시작일(1~28). 1=달력월, 13=13일~다음달 12일.';

-- 역삼점: 13일 결산
update public.branches set fiscal_start_day = 13 where id = '4cb29533-d8e1-4b8b-b0bd-7ce3c5bf1d7a';

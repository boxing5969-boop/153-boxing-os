-- 브로제이 센터(group_id) ↔ 우리 지점 매핑. 회원·매출·출석 동기화의 대상 지점 판별용.
alter table public.branches add column if not exists broj_group_id text;
comment on column public.branches.broj_group_id is '브로제이 오픈API 센터 ID(group_id). 동기화 대상 매핑용.';

-- 선릉점 = 브로제이 CENTER 키의 접근 지점
update public.branches
set broj_group_id = '01KYH0PPBPA19XN6G0KS5B1AQ3'
where id = '5a4e9165-38b6-4e4e-8e6d-62d5cf1ce850';

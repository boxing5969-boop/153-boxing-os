-- 지점별 사업자등록번호 — 결제확인서 하단 표기용 (회사 제출 증빙 관행)
alter table public.branches add column if not exists biz_number text;
comment on column public.branches.biz_number is '사업자등록번호(표기용, 예: 123-45-67890) — 결제확인서 하단에 자동 표기';

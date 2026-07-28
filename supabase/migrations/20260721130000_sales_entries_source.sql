-- 매출 출처 표시 — 브로제이 자동 동기화분을 수기 입력과 구분(재동기화 시 broj 분만 삭제·재삽입).
alter table public.sales_entries add column if not exists source text not null default 'manual';
comment on column public.sales_entries.source is 'manual=수기입력 / broj=브로제이 자동동기화';
create index if not exists idx_sales_entries_broj on public.sales_entries(branch_id, sale_date) where source='broj';

-- 환불 라인을 음수 금액으로 기록할 수 있어야 결제수단별 순액이 맞는다.
-- (기존 CHECK amount >= 0 은 브로제이 환불 동기화를 막음)
alter table public.sales_entries drop constraint if exists sales_entries_amount_check;
comment on column public.sales_entries.amount is '결제 금액. 환불은 음수로 기록(순액 집계용).';

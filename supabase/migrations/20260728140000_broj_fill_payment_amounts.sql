-- 브로제이 매출(sales_entries)에서 회원별 '가장 최근 수강권 결제금액'을
-- member_snapshots.payment_amount 에 채운다. 환불계산기 자동채움이 이 값을 쓴다.
--
-- 회원 동기화가 명부를 통째로 갈아끼우면 결제금액이 비므로, 동기화 직후 항상 이 함수를 돌린다
-- (워커 syncMembers 라우트 + 매일 밤 자동 동기화에서 호출).
-- 매칭 = 같은 지점 + 같은 이름(동명이인은 최근 결제 1건으로 대표). 물품(락커·용품)은 제외.
-- 적용 완료: 2026-07-28 (Supabase tbxdrfowanyksgdicryl)
create or replace function public.broj_fill_payment_amounts(_branch_id uuid default null)
returns table(branch_id uuid, filled integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with latest as (
    select distinct on (s.branch_id, s.member_name)
           s.branch_id as bid, s.member_name as nm, s.amount as amt
    from sales_entries s
    where s.source = 'broj'
      and s.amount > 0
      and s.category = '수강권'
      and coalesce(s.member_name, '') <> ''
      and (_branch_id is null or s.branch_id = _branch_id)
    order by s.branch_id, s.member_name, s.sale_date desc, s.amount desc
  ), upd as (
    update member_snapshots m
       set payment_amount = l.amt
      from latest l
     where m.branch_id = l.bid
       and m.member_name = l.nm
       and m.payment_amount is distinct from l.amt
    returning m.branch_id as bid
  )
  select u.bid, count(*)::integer from upd u group by u.bid;
end;
$$;

comment on function public.broj_fill_payment_amounts(uuid) is
  '브로제이 매출에서 회원별 최근 수강권 결제금액을 member_snapshots.payment_amount 로 채움(환불계산기 자동채움용)';

-- ⚠️ 이 프로젝트는 새 객체에 service_role 권한이 자동으로 붙지 않는다.
grant execute on function public.broj_fill_payment_amounts(uuid) to service_role;
grant execute on function public.broj_fill_payment_amounts(uuid) to authenticated;

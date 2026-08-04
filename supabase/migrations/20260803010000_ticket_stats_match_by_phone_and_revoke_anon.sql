-- ⚠️ 2026-08-03 MCP apply_migration 으로 **이미 라이브 적용**된 변경의 레포 사본(드리프트 방지).
--
-- ① 이용권 보강(잔여횟수·만료일)도 전화번호 기준으로 — 출석 통계와 같은 이유.
--    이름 조인은 동명이인(실측 29그룹)의 잔여횟수·만료일을 서로 덮어쓴다.
create or replace function public.broj_refresh_ticket_stats(_branch_id uuid default null)
returns table(branch_id uuid, sessions_filled integer, expiry_filled integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return query
  with latest as (
    select distinct on (a.branch_id, np)
           a.branch_id as bid,
           nullif(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), '') as np,
           a.member_name as nm,
           a.remain_count as remain, a.ticket_expire_date as exp
    from attendance_logs a
    where coalesce(a.attendance_status, 'SUCCESS') in ('SUCCESS', 'SHOW')
      and coalesce(a.ticket_type, '') not in ('LOCKER', 'SPORTSWEAR')
      and (_branch_id is null or a.branch_id = _branch_id)
    order by a.branch_id, np, a.attend_date desc, a.attended_at desc
  ), upd as (
    update member_snapshots m
       set remaining_sessions = coalesce(l.remain, m.remaining_sessions),
           end_date = coalesce(m.end_date, l.exp)
      from latest l
     where m.branch_id = l.bid
       and (
         (l.np is not null and m.normalized_phone = l.np)
         or (l.np is null and coalesce(m.normalized_phone, '') = '' and m.member_name = l.nm)
       )
       and (
         (l.remain is not null and m.remaining_sessions is distinct from l.remain)
         or (m.end_date is null and l.exp is not null)
       )
    returning m.branch_id as bid,
              (l.remain is not null) as got_remain,
              (m.end_date is not null and l.exp is not null) as got_exp
  )
  select u.bid,
         count(*) filter (where u.got_remain)::integer,
         count(*) filter (where u.got_exp)::integer
  from upd u group by u.bid;
end;
$function$;

-- ② SECURITY DEFINER 쓰기 함수의 익명 실행 차단(advisor 지적) — 워커(service_role)는 영향 없음.
revoke execute on function public.broj_refresh_attendance_stats(uuid) from public, anon, authenticated;
revoke execute on function public.broj_refresh_ticket_stats(uuid) from public, anon, authenticated;
revoke execute on function public.broj_fill_payment_amounts(uuid) from public, anon, authenticated;

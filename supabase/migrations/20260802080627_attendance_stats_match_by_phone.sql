-- ⚠️ 이 파일은 2026-08-02 에 MCP apply_migration 으로 **이미 라이브 적용**된 함수의 레포 사본이다.
--    (레포에 없으면 db reset·새 환경에서 구버전(이름 조인)으로 회귀한다 — 드리프트 방지용)
--
-- 방문 횟수(visits_7d/30d/90d) 집계를 **전화번호 기준**으로.
-- 이름 조인은 ① 동명이인 합산(최대 40회 차이 실측) ② 명부↔기록 이름 불일치 시 0 표시
-- ③ 기록 없는 회원의 옛 숫자 잔존 — 1,247명 중 56명이 틀려 있었다.
create or replace function public.broj_refresh_attendance_stats(_branch_id uuid default null)
returns table(branch_id uuid, updated integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  return query
  with src as (
    select a.branch_id as bid,
           nullif(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), '') as np,
           a.member_name as nm,
           a.attend_date as ad
    from attendance_logs a
    where coalesce(a.attendance_status, 'SUCCESS') in ('SUCCESS', 'SHOW')
      and (_branch_id is null or a.branch_id = _branch_id)
  ),
  by_phone as (
    select bid, np,
           count(*) filter (where ad >= today - 7)  as v7,
           count(*) filter (where ad >= today - 30) as v30,
           count(*) filter (where ad >= today - 90) as v90,
           max(ad) as last_visit
    from src where np is not null group by bid, np
  ),
  by_name as (
    select bid, nm,
           count(*) filter (where ad >= today - 7)  as v7,
           count(*) filter (where ad >= today - 30) as v30,
           count(*) filter (where ad >= today - 90) as v90,
           max(ad) as last_visit
    from src where np is null and coalesce(nm, '') <> '' group by bid, nm
  ),
  live as (select distinct bid from src),
  upd_p as (
    update member_snapshots m
       set visits_7d = g.v7, visits_30d = g.v30, visits_90d = g.v90,
           latest_visit_date = greatest(coalesce(m.latest_visit_date, g.last_visit), g.last_visit)
      from by_phone g
     where m.branch_id = g.bid and m.normalized_phone = g.np
    returning m.branch_id as bid
  ),
  upd_n as (
    update member_snapshots m
       set visits_7d = g.v7, visits_30d = g.v30, visits_90d = g.v90,
           latest_visit_date = greatest(coalesce(m.latest_visit_date, g.last_visit), g.last_visit)
      from by_name g
     where m.branch_id = g.bid and coalesce(m.normalized_phone, '') = '' and m.member_name = g.nm
    returning m.branch_id as bid
  ),
  upd_z as (
    update member_snapshots m
       set visits_7d = 0, visits_30d = 0, visits_90d = 0
     where m.branch_id in (select bid from live)
       and (_branch_id is null or m.branch_id = _branch_id)
       and coalesce(m.visits_90d, 0) <> 0
       and not exists (select 1 from by_phone p where p.bid = m.branch_id and p.np = m.normalized_phone)
       and not exists (select 1 from by_name n where n.bid = m.branch_id and n.nm = m.member_name and coalesce(m.normalized_phone, '') = '')
    returning m.branch_id as bid
  )
  select t.bid, count(*)::integer
    from (select bid from upd_p union all select bid from upd_n union all select bid from upd_z) t
   group by t.bid;
end;
$function$;

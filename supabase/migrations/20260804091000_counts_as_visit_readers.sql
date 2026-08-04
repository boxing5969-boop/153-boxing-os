-- attendance_logs 를 읽는 DB 함수 전부를 counts_as_visit 기준으로 통일.
-- 적용 완료: 2026-08-04 (Supabase tbxdrfowanyksgdicryl)
--
-- ⚠️ 20260804090000_attendance_counts_as_visit.sql 다음에 실행되어야 한다(컬럼 선행).
-- ⚠️ 이 파일이 없으면 db reset 시 함수가 구버전(attendance_status 문자열 기준)으로 회귀해
--    직원 출근이 회원 방문으로 집계된다. 아래 5개가 '방문'의 단일 기준을 공유한다.
--      broj_refresh_attendance_stats / broj_refresh_ticket_stats
--      ops_message_effect / ops_attendance_overview / first4w_retention
--
-- 정본 정의는 각 기능의 원본 마이그레이션이 아니라 **여기**다(마지막 적용본).
-- 세부 본문은 라이브에 적용된 것과 동일하며, 원본 파일들은 이력 보존용으로 남긴다.

-- 1) 회원 방문 통계(visits_7d/30d/90d, latest_visit_date)
--    → 20260802080627_attendance_stats_match_by_phone.sql 의 본문에서 where 절만 교체
--      (전화번호 기준 매칭 로직은 그대로)
create or replace function public.broj_refresh_attendance_stats(_branch_id uuid DEFAULT NULL::uuid)
 returns table(branch_id uuid, updated integer)
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  return query
  with src as (
    select a.branch_id as bid,
           nullif(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), '') as np,
           a.member_name as nm, a.attend_date as ad
    from attendance_logs a
    where a.counts_as_visit
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
revoke execute on function public.broj_refresh_attendance_stats(uuid) from public, anon, authenticated;

-- 2) 이용권 잔여·만료 채우기
create or replace function public.broj_refresh_ticket_stats(_branch_id uuid DEFAULT NULL::uuid)
 returns table(branch_id uuid, sessions_filled integer, expiry_filled integer)
 language plpgsql security definer set search_path to 'public'
as $function$
begin
  return query
  with latest as (
    select distinct on (a.branch_id, np)
           a.branch_id as bid,
           nullif(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), '') as np,
           a.member_name as nm, a.remain_count as remain, a.ticket_expire_date as exp
    from attendance_logs a
    where a.counts_as_visit
      and coalesce(a.ticket_type, '') not in ('LOCKER', 'SPORTSWEAR')
      and (_branch_id is null or a.branch_id = _branch_id)
    order by a.branch_id, np, a.attend_date desc, a.attended_at desc
  ), upd as (
    update member_snapshots m
       set remaining_sessions = coalesce(l.remain, m.remaining_sessions),
           end_date = coalesce(m.end_date, l.exp)
      from latest l
     where m.branch_id = l.bid
       and ((l.np is not null and m.normalized_phone = l.np)
         or (l.np is null and coalesce(m.normalized_phone, '') = '' and m.member_name = l.nm))
       and ((l.remain is not null and m.remaining_sessions is distinct from l.remain)
         or (m.end_date is null and l.exp is not null))
    returning m.branch_id as bid, (l.remain is not null) as got_remain,
              (m.end_date is not null and l.exp is not null) as got_exp
  )
  select u.bid, count(*) filter (where u.got_remain)::integer, count(*) filter (where u.got_exp)::integer
  from upd u group by u.bid;
end;
$function$;
revoke execute on function public.broj_refresh_ticket_stats(uuid) from public, anon, authenticated;

-- 3) 문자 효과 측정 — '보낸 뒤 실제로 다시 왔는가'
create or replace function public.ops_message_effect(_branch_id uuid default null, _days integer default 90)
returns table(template_type text, sent integer, eligible integer, returned integer, return_rate numeric)
language sql security definer set search_path = public
as $$
  with logs as (
    select l.id, l.branch_id, l.recipient_name,
           regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') as ph,
           coalesce(nullif(l.template_type, ''), '기타') as tmpl,
           (l.created_at at time zone 'Asia/Seoul')::date as sent_date
    from ops_message_logs l
    where l.created_at >= now() - make_interval(days => greatest(_days, 1))
      and coalesce(l.status, 'sent') <> 'failed'
      and (_branch_id is null or l.branch_id = _branch_id)
      and (l.created_at at time zone 'Asia/Seoul')::date <= (now() at time zone 'Asia/Seoul')::date - 7
  ), matched as (
    select g.id, g.tmpl, g.sent_date,
      exists (select 1 from attendance_logs a
        where a.branch_id = g.branch_id and a.counts_as_visit
          and a.attend_date between g.sent_date - 7 and g.sent_date - 1
          and ((g.ph <> '' and regexp_replace(coalesce(a.phone, ''), '\D', '', 'g') = g.ph)
            or (g.ph = '' and a.member_name = g.recipient_name))) as came_before,
      exists (select 1 from attendance_logs a
        where a.branch_id = g.branch_id and a.counts_as_visit
          and a.attend_date between g.sent_date and g.sent_date + 7
          and ((g.ph <> '' and regexp_replace(coalesce(a.phone, ''), '\D', '', 'g') = g.ph)
            or (g.ph = '' and a.member_name = g.recipient_name))) as came_after
    from logs g
  )
  select m.tmpl, count(*)::integer,
         count(*) filter (where not m.came_before)::integer,
         count(*) filter (where not m.came_before and m.came_after)::integer,
         case when count(*) filter (where not m.came_before) > 0
              then round(100.0 * count(*) filter (where not m.came_before and m.came_after)
                         / count(*) filter (where not m.came_before), 1) else null end
  from matched m group by m.tmpl having count(*) > 0
  order by count(*) filter (where not m.came_before) desc;
$$;

-- 4) 출석 현황 한눈에 — 🚨 여기가 필터 0이었다. 직원 출근은 매일 반복이라 시간이 갈수록 계속 부풀었다.
create or replace function public.ops_attendance_overview(_branch_id uuid, _weeks integer default 8)
returns jsonb language sql stable security definer set search_path to 'public'
as $$
with logs as (
  select a.member_name, a.attend_date from attendance_logs a
  where a.branch_id = _branch_id and a.counts_as_visit
),
span as (select min(attend_date) first_date, max(attend_date) last_date, count(*)::int total_logs from logs),
weeks as (
  select date_trunc('week', attend_date)::date week_start,
         count(distinct member_name)::int visitors,
         count(distinct (member_name || attend_date::text))::int visits
  from logs where attend_date >= (current_date - (_weeks * 7)) group by 1 order by 1
),
active as (select count(*)::int n from member_snapshots m
  where m.branch_id = _branch_id and (m.end_date is null or m.end_date >= current_date)),
buckets as (
  select count(*) filter (where coalesce(m.visits_30d,0) >= 12) steady,
         count(*) filter (where coalesce(m.visits_30d,0) between 5 and 11) normal,
         count(*) filter (where coalesce(m.visits_30d,0) between 1 and 4) low,
         count(*) filter (where m.visits_30d = 0) none30,
         count(*) filter (where m.visits_30d is null) unknown,
         count(*) filter (where coalesce(m.visits_7d,0) = 0 and m.visits_7d is not null) none7
  from member_snapshots m
  where m.branch_id = _branch_id and (m.end_date is null or m.end_date >= current_date))
select jsonb_build_object(
  'first_date', (select first_date from span), 'last_date', (select last_date from span),
  'total_logs', (select total_logs from span),
  'day_span', coalesce((select (last_date - first_date) + 1 from span), 0),
  'active_members', (select n from active),
  'buckets', (select to_jsonb(b) from buckets b),
  'weeks', coalesce((select jsonb_agg(to_jsonb(w) order by w.week_start) from weeks w), '[]'::jsonb));
$$;

-- 5) 첫 4주 효과 — covered(자료 보유 여부)는 일부러 필터를 안 건다(실패·직원 기록도 커버리지 근거)
create or replace function public.first4w_retention(_branch_id uuid default null)
returns table(bucket text, sort_order integer, members integer, retained integer, retain_rate numeric)
language sql security definer set search_path to 'public'
as $$
  with today as (select (now() at time zone 'Asia/Seoul')::date d),
  base as (
    select m.id, m.branch_id, m.member_name, m.start_date, m.end_date,
           (select count(*) from attendance_logs a
             where a.branch_id = m.branch_id and a.member_name = m.member_name
               and a.counts_as_visit
               and a.attend_date >= m.start_date and a.attend_date < m.start_date + 28) as v4w,
           exists (select 1 from attendance_logs a2
                    where a2.branch_id = m.branch_id and a2.attend_date <= m.start_date + 28) as covered
    from member_snapshots m, today t
    where m.start_date is not null and m.start_date <= t.d - 60
      and (_branch_id is null or m.branch_id = _branch_id)
  ), tagged as (
    select case when b.v4w >= 12 then '12회 이상' when b.v4w >= 8 then '8~11회'
                when b.v4w >= 4 then '4~7회' else '0~3회' end as bucket,
           case when b.v4w >= 12 then 4 when b.v4w >= 8 then 3 when b.v4w >= 4 then 2 else 1 end as sort_order,
           (b.end_date is not null and b.end_date >= (select d from today)) as retained
    from base b where b.covered
  )
  select g.bucket, g.sort_order, count(*)::integer,
         count(*) filter (where g.retained)::integer,
         case when count(*) > 0 then round(100.0 * count(*) filter (where g.retained) / count(*), 1) else null end
  from tagged g group by g.bucket, g.sort_order order by g.sort_order;
$$;

-- ⚠️ 위 3개 + 발송함 요약은 SECURITY DEFINER 인데 호출자 검증 없이 _branch_id 를 믿는다.
--    워커(service_role)만 부르므로 브라우저 권한을 회수한다 — 안 하면 남의 지점 집계가 그대로 열린다.
revoke execute on function public.ops_message_effect(uuid, integer) from public, anon, authenticated;
revoke execute on function public.ops_attendance_overview(uuid, integer) from public, anon, authenticated;
revoke execute on function public.first4w_retention(uuid) from public, anon, authenticated;

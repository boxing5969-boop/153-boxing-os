-- B4: 브로제이 출석(출입) 이력 — 회원 분류·이탈 징후 감지의 기반 데이터.
-- 지금까지는 '마지막 방문일' 하나만 있어서 '매주 오던 회원이 뜸해진 것'과
-- '원래 가끔 오던 회원'을 구분할 수 없었다. 개별 출석 기록을 쌓아 빈도로 판단한다.
-- 적용 완료: 2026-07-29 (Supabase tbxdrfowanyksgdicryl)

create table if not exists public.attendance_logs (
  id                 uuid primary key default gen_random_uuid(),
  branch_id          uuid not null references public.branches(id) on delete cascade,
  broj_attendance_id text not null,                 -- 브로제이 출석 ID (멱등 키)
  broj_member_id     text,
  member_name        text,
  phone              text,
  attended_at        timestamptz,                   -- 출석 시각(원본)
  attend_date        date not null,                 -- KST 기준 날짜(집계용)
  attendance_type    text,                          -- ENTRY / CLASS / FACILITY / GO_TO_WORK
  attendance_status  text,                          -- SUCCESS / FAILURE
  ticket_name        text,
  ticket_type        text,
  remain_count       integer,                       -- 이용권 잔여 횟수
  ticket_expire_date date,                          -- 이용권 만료일(회원 만료일 보완용)
  device_name        text,
  created_at         timestamptz not null default now()
);

comment on table public.attendance_logs is '브로제이 출석(출입) 이력. 회원 방문 빈도·이탈 징후 판단용. 재동기화해도 중복되지 않는다.';

create unique index if not exists attendance_logs_uniq
  on public.attendance_logs (branch_id, broj_attendance_id);
create index if not exists attendance_logs_branch_date_idx
  on public.attendance_logs (branch_id, attend_date desc);
create index if not exists attendance_logs_member_idx
  on public.attendance_logs (branch_id, member_name, attend_date desc);

alter table public.attendance_logs enable row level security;

drop policy if exists attendance_logs_select on public.attendance_logs;
create policy attendance_logs_select on public.attendance_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.auth_user_id = auth.uid()
        and p.status = 'active'
        and (p.role in ('super_admin','hq_admin') or p.branch_id = attendance_logs.branch_id)
    )
  );

-- ⚠️ 이 프로젝트는 새 테이블에 service_role 권한이 자동으로 붙지 않는다(워커 permission denied 방지).
grant select, insert, update, delete on public.attendance_logs to service_role;
grant select on public.attendance_logs to authenticated;

-- 회원 명부에 방문 빈도 캐시 컬럼 (화면에서 매번 집계하지 않도록)
alter table public.member_snapshots
  add column if not exists visits_7d   integer,
  add column if not exists visits_30d  integer,
  add column if not exists visits_90d  integer;

comment on column public.member_snapshots.visits_30d is '최근 30일 출석 횟수(브로제이 출석 이력 집계)';

-- 출석 동기화도 같은 이력 테이블에 남긴다
alter table public.broj_sync_runs drop constraint if exists broj_sync_runs_kind_check;
alter table public.broj_sync_runs
  add constraint broj_sync_runs_kind_check check (kind in ('members', 'sales', 'attendance'));

-- 출석 이력 → 회원 명부의 방문 빈도(7/30/90일) + 마지막 방문일 갱신.
-- 매칭 = 같은 지점 + 같은 이름. 출석 성공 건만 센다.
create or replace function public.broj_refresh_attendance_stats(_branch_id uuid default null)
returns table(branch_id uuid, updated integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  return query
  with agg as (
    select a.branch_id as bid,
           a.member_name as nm,
           count(*) filter (where a.attend_date >= today - 7)  as v7,
           count(*) filter (where a.attend_date >= today - 30) as v30,
           count(*) filter (where a.attend_date >= today - 90) as v90,
           max(a.attend_date) as last_visit
    from attendance_logs a
    where coalesce(a.attendance_status, 'SUCCESS') <> 'FAILURE'
      and coalesce(a.member_name, '') <> ''
      and (_branch_id is null or a.branch_id = _branch_id)
    group by a.branch_id, a.member_name
  ), upd as (
    update member_snapshots m
       set visits_7d  = g.v7,
           visits_30d = g.v30,
           visits_90d = g.v90,
           latest_visit_date = greatest(coalesce(m.latest_visit_date, g.last_visit), g.last_visit)
      from agg g
     where m.branch_id = g.bid
       and m.member_name = g.nm
    returning m.branch_id as bid
  )
  select u.bid, count(*)::integer from upd u group by u.bid;
end;
$$;

comment on function public.broj_refresh_attendance_stats(uuid) is
  '출석 이력에서 회원별 7/30/90일 방문 횟수와 마지막 방문일을 member_snapshots 에 반영';

grant execute on function public.broj_refresh_attendance_stats(uuid) to service_role;
grant execute on function public.broj_refresh_attendance_stats(uuid) to authenticated;

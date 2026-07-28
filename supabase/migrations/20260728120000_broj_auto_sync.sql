-- B5: 브로제이 자동 동기화 — 지점별 on/off + 실행 이력
-- 자동(크론)·수동(버튼) 실행 결과를 모두 남겨 "마지막으로 언제 성공했는지"를 화면에서 확인한다.
-- 적용 완료: 2026-07-28 (Supabase tbxdrfowanyksgdicryl)

alter table public.branches
  add column if not exists broj_auto_sync boolean not null default true;

comment on column public.branches.broj_auto_sync is '브로제이 자동 동기화 사용 여부(크론). false면 이 지점은 자동 동기화에서 제외.';

create table if not exists public.broj_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches(id) on delete cascade,
  kind         text not null check (kind in ('members', 'sales')),
  mode         text not null default 'auto' check (mode in ('auto', 'manual')),
  status       text not null check (status in ('success', 'failed')),
  from_date    date,
  to_date      date,
  fetched      integer not null default 0,
  written      integer not null default 0,
  sales_total  bigint  not null default 0,
  error_message text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table public.broj_sync_runs is '브로제이 동기화 실행 이력(자동 크론 + 수동 버튼). 감사·모니터링용.';

create index if not exists broj_sync_runs_branch_idx
  on public.broj_sync_runs (branch_id, created_at desc);
create index if not exists broj_sync_runs_created_idx
  on public.broj_sync_runs (created_at desc);

-- ⚠️ 이 프로젝트는 새 테이블에 service_role DML 권한이 자동으로 붙지 않는다.
--    빠뜨리면 워커가 'permission denied for table ...' 로 실패한다(실제로 겪음).
grant select, insert, update, delete on public.broj_sync_runs to service_role;
grant select, insert, update, delete on public.broj_sync_runs to authenticated;
grant select on public.broj_sync_runs to anon;

alter table public.broj_sync_runs enable row level security;

-- 읽기: 본사 전체 / 지점 계정은 본인 지점만. 쓰기는 워커(service role)만 — 정책을 두지 않는다.
drop policy if exists broj_sync_runs_select on public.broj_sync_runs;
create policy broj_sync_runs_select on public.broj_sync_runs
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.auth_user_id = auth.uid()
        and p.status = 'active'
        and (
          p.role in ('super_admin', 'hq_admin')
          or p.branch_id = broj_sync_runs.branch_id
        )
    )
  );

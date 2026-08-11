-- automation_dispatch_log 중복발송 방지 제약 — 레포 형상 고정
--
-- 배경: 자동발송(automationRunner)의 이중발송 차단은 전적으로 이 unique 제약 하나에 달려 있다.
--   발송 '전에' 슬롯을 insert 로 선점하고, 충돌하면 보내지 않는다(발송 후 기록이 아니라 선점이라
--   크론이 중복 실행돼도 레이스가 없다). 그런데 이 제약이 라이브 DB에만 있고 마이그레이션에는
--   없어, 복구·재구축·환경 이관 때 조용히 사라지면 **모든 자동문자가 매 슬롯마다 중복 발송**된다.
--   (2026-08-11 검수 지적)
--
-- ⚠️ 라이브에는 이미 automation_dispatch_log_branch_id_member_id_kind_step_chann_key 로 존재한다.
--   같은 컬럼에 인덱스를 하나 더 만들면 매 insert 마다 쓰기 비용만 두 배가 되므로,
--   **동등한 unique 인덱스가 이미 있으면 아무것도 하지 않는다.** 새 환경에서만 생성된다.

do $$
begin
  if not exists (
    select 1
      from pg_index i
      join pg_class t on t.oid = i.indrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'automation_dispatch_log'
       and i.indisunique
       and (
         select array_agg(a.attname::text order by a.attname)
           from unnest(i.indkey) k
           join pg_attribute a on a.attrelid = t.oid and a.attnum = k
       ) = array['branch_id','channel','kind','member_id','step']
  ) then
    create unique index automation_dispatch_log_uniq
      on public.automation_dispatch_log (branch_id, member_id, kind, step, channel);
  end if;
end $$;

-- 사전 필터(40일 창) 조회용 — 이미 있으면 무시
create index if not exists idx_autodispatch_branch_date
  on public.automation_dispatch_log (branch_id, dispatched_on);

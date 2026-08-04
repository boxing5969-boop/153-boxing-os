-- 보낸 문자함(발송함) 요약 — 종류별 건수.
-- 적용 완료: 2026-08-04 (Supabase tbxdrfowanyksgdicryl)
--
-- 왜 RPC 인가: 목록은 페이지네이션이라 화면에서 종류를 집계하면 '이 페이지에 있는 것'만 세어 숫자가 틀린다.
-- PostgREST 로 전량을 받아 세면 1000행에서 잘린다. 집계는 DB 가 해야 정확하다.
create or replace function public.ops_message_outbox_summary(
  _branch_id uuid,
  _since timestamptz,
  _created_by uuid default null      -- 코치처럼 '본인 발송분만' 볼 때
)
returns table(template_type text, is_auto boolean, n integer, last_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select coalesce(nullif(l.template_type, ''), '(기타)') as template_type,
         -- 자동 판정은 워커(dailyReports.isAutoType)·프론트(messageOutbox.isAutoSend)와 같은 규칙 —
         -- 셋 중 하나만 바꾸면 탭 숫자가 갈린다.
         (coalesce(l.template_type, '') like 'auto\_%' or l.template_type = 'daily_auto_report') as is_auto,
         count(*)::integer as n,
         max(l.created_at) as last_at
    from ops_message_logs l
   where l.branch_id = _branch_id
     and l.created_at >= _since
     and (_created_by is null or l.created_by = _created_by)
   group by 1, 2
   order by n desc;
$$;

comment on function public.ops_message_outbox_summary(uuid, timestamptz, uuid) is
  '보낸 문자함 종류별 건수 — 목록 페이지네이션과 무관하게 전체를 센다';

-- 🚨 SECURITY DEFINER + 호출자 검증 없음. 워커(service_role)만 부른다.
--    authenticated 에 열어두면 브라우저에서 아무 지점 branch_id 로 직접 호출해
--    워커의 지점·코치 범위 검사를 통째로 우회할 수 있다(2026-08-04 검수 지적 H-1).
revoke execute on function public.ops_message_outbox_summary(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.ops_message_outbox_summary(uuid, timestamptz, uuid) to service_role;

-- 문자 효과 측정: '보낸 뒤 실제로 다시 왔는가'를 출석 기록으로 대조한다.
-- 적용 완료: 2026-07-29 (Supabase tbxdrfowanyksgdicryl)
--
-- 측정 원칙
--  · 대상(eligible) = 발송 직전 7일간 방문이 0이었던 건만. 원래 매일 오던 회원이
--    문자와 무관하게 다음 날 온 것을 성과로 착각하지 않기 위함.
--  · 복귀(returned) = 발송 후 7일 이내 출석 1건 이상.
--  · 발송 후 7일이 안 지난 건은 판정 불가라 제외한다.
--  · 매칭 = 전화번호 숫자만(우선), 없으면 이름.
create or replace function public.ops_message_effect(
  _branch_id uuid default null,
  _days integer default 90
)
returns table(
  template_type text,
  sent integer,
  eligible integer,
  returned integer,
  return_rate numeric
)
language sql
security definer
set search_path = public
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
      exists (
        select 1 from attendance_logs a
        where a.branch_id = g.branch_id
          and coalesce(a.attendance_status, 'SUCCESS') <> 'FAILURE'
          and a.attend_date between g.sent_date - 7 and g.sent_date - 1
          and (
            (g.ph <> '' and regexp_replace(coalesce(a.phone, ''), '\D', '', 'g') = g.ph)
            or (g.ph = '' and a.member_name = g.recipient_name)
          )
      ) as came_before,
      exists (
        select 1 from attendance_logs a
        where a.branch_id = g.branch_id
          and coalesce(a.attendance_status, 'SUCCESS') <> 'FAILURE'
          and a.attend_date between g.sent_date and g.sent_date + 7
          and (
            (g.ph <> '' and regexp_replace(coalesce(a.phone, ''), '\D', '', 'g') = g.ph)
            or (g.ph = '' and a.member_name = g.recipient_name)
          )
      ) as came_after
    from logs g
  )
  select m.tmpl as template_type,
         count(*)::integer as sent,
         count(*) filter (where not m.came_before)::integer as eligible,
         count(*) filter (where not m.came_before and m.came_after)::integer as returned,
         case when count(*) filter (where not m.came_before) > 0
              then round(100.0 * count(*) filter (where not m.came_before and m.came_after)
                         / count(*) filter (where not m.came_before), 1)
              else null end as return_rate
  from matched m
  group by m.tmpl
  having count(*) > 0
  order by count(*) filter (where not m.came_before) desc;
$$;

comment on function public.ops_message_effect(uuid, integer) is
  '문구별 문자 효과 — 발송 직전 7일 미방문 회원 중, 발송 후 7일 내 재방문 비율';

grant execute on function public.ops_message_effect(uuid, integer) to service_role;
grant execute on function public.ops_message_effect(uuid, integer) to authenticated;

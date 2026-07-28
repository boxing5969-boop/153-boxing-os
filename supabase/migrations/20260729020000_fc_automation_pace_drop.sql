-- 페이스 하락(출석 빈도가 평소 절반 이하로 떨어진 유효회원) 자동 안부 문자.
-- 기본 OFF — 지점이 켜야 나간다(자동발송은 항상 명시적 동의 후에만).
-- 적용 완료: 2026-07-29 (Supabase tbxdrfowanyksgdicryl)
alter table public.fc_automation_config
  add column if not exists pace_drop_enabled boolean not null default false;

comment on column public.fc_automation_config.pace_drop_enabled is
  '페이스 하락 회원 자동 안부 문자 사용 여부. 출석 동기화가 돼 있어야 대상이 잡힌다. 회원당 30일 1회.';

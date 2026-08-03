-- 앞 마이그레이션 보정: 함수는 기본적으로 PUBLIC 에 EXECUTE 가 부여되므로 anon 개별 회수만으로는 막히지 않는다.
-- (실측: anon 회수 후에도 has_function_privilege('anon', ...) = true 였다 — PUBLIC 상속)
-- CRM 대시보드(DeniedReasonsCard·LossPreventionCard)는 authenticated 로 호출하므로 그 역할만 남긴다.
-- ※ 운영 적용본(version 20260803144253)을 저장소로 회수한 파일.
REVOKE EXECUTE ON FUNCTION public.get_denied_reason_stats(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_denied_reason_stats(integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_daily_report_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_report_stats(uuid) TO service_role;

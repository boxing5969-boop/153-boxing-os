-- 직원 점수판 오류 수정: "permission denied for function ops_staff_scores"
-- 원인: 함수 생성 시 EXECUTE 권한이 postgres 에만 남아(service_role 누락) 워커 호출이 거부됨.
-- 조치: 워커(service_role)에만 EXECUTE 부여. 브라우저 롤(anon/authenticated)에는 부여하지 않는다
--       (프론트는 워커 API /api/reports/staff-scores 경유가 유일 경로).
grant execute on function public.ops_staff_scores(date, date, uuid) to service_role;

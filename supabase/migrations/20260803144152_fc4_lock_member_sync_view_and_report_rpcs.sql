-- boxer 검수(2026-08-03): 익명 키로 회원 3,195명 이름·전화·생년월일·누적결제액이 조회되던 구멍 차단.
-- v_members_for_app_sync 는 SECURITY DEFINER(기본)로 하위 테이블 RLS를 우회했고 anon/authenticated 에 SELECT 가 열려 있었다.
-- 앱 미러 동기화는 service_role(엣지함수 sync-members-to-app) 경유라 anon 회수해도 기능 영향 없음.
-- ※ 이 파일은 운영에 이미 적용된 마이그레이션(version 20260803144152)을 저장소로 회수한 것.
ALTER VIEW public.v_members_for_app_sync SET (security_invoker = on);
REVOKE ALL ON public.v_members_for_app_sync FROM anon;
REVOKE ALL ON public.v_members_for_app_sync FROM authenticated;
GRANT SELECT ON public.v_members_for_app_sync TO service_role;

-- 리포트 RPC 권한 정리: 실제 호출자는 워커(service_role)뿐.
-- get_daily_report_stats 는 SECURITY DEFINER 인데 _branch_id 를 그대로 신뢰해 타지점 지표 조회가 가능했다.
REVOKE EXECUTE ON FUNCTION public.get_daily_report_stats(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_denied_reason_stats(integer) FROM anon;

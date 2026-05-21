-- ============================================================
-- 민감 함수의 anon(비로그인) EXECUTE 권한 회수
-- ============================================================
-- SECURITY DEFINER 함수는 RLS 를 우회하므로, 공개 anon 키만으로
-- 누구나 직접 호출할 수 있으면 위험하다. 출입통제·결제·정산·설정
-- 관련 민감 함수 18개에서 비로그인 실행 권한을 제거한다.
--
-- anon 은 PUBLIC 을 통해서도 EXECUTE 를 받으므로 PUBLIC 에서 회수하고,
-- Workers API 가 쓰는 service_role 과 로그인 사용자(authenticated)에게는
-- 다시 부여한다. (Workers API 는 모든 호출을 service_role 로 수행한다.)
--
-- 공개 설문 함수(get_public_survey 등)와 슬러그 확인(check_slug_available)은
-- 비로그인 흐름에 필요하므로 회수 대상에서 제외한다.
-- ============================================================

-- 비상 PIN
REVOKE EXECUTE ON FUNCTION public.issue_emergency_pin(uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.issue_emergency_pin(uuid, text, integer, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.consume_emergency_pin(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.consume_emergency_pin(uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.revoke_emergency_pin(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.revoke_emergency_pin(uuid) TO authenticated, service_role;

-- 결제 / 정산
REVOKE EXECUTE ON FUNCTION public.refund_membership(uuid, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.refund_membership(uuid, numeric, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_outstanding_payments(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_outstanding_payments(uuid) TO authenticated, service_role;

-- 지점 설정 / 회사 생성
REVOKE EXECUTE ON FUNCTION public.update_branch_kakao_settings(uuid, text, text, text, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_branch_kakao_settings(uuid, text, text, text, text, text, text, text, boolean) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.provision_new_company(text, text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.provision_new_company(text, text, text, text, text, text, uuid) TO authenticated, service_role;

-- 단말기 / 동기화
REVOKE EXECUTE ON FUNCTION public.force_device_sync(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.force_device_sync(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.enqueue_member_sync(uuid, sync_job_type) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.enqueue_member_sync(uuid, sync_job_type) TO authenticated, service_role;

-- 이용권 휴회
REVOKE EXECUTE ON FUNCTION public.start_membership_hold(uuid, date, date, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_membership_hold(uuid, date, date, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.resume_membership_hold(uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resume_membership_hold(uuid, date) TO authenticated, service_role;

-- 동의 기록
REVOKE EXECUTE ON FUNCTION public.record_member_consent(uuid, consent_type) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_member_consent(uuid, consent_type) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.revoke_member_consent(uuid, consent_type) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.revoke_member_consent(uuid, consent_type) TO authenticated, service_role;

-- 매출 / 통계 대시보드
REVOKE EXECUTE ON FUNCTION public.get_hq_kpi_dashboard() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_hq_kpi_dashboard() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_revenue_summary(date, date, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_revenue_summary(date, date, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_revenue_daily(date, date, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_revenue_daily(date, date, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_daily_report_stats(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_daily_report_stats(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_hq_branch_stats() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_hq_branch_stats() TO authenticated, service_role;

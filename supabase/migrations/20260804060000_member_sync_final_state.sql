-- 결제 상태 변경 시 단말기 동기화를 '최종 회원 상태' 기준으로 확정한다.
--
-- 문제 1) memberships 트리거는 이용권 변화만 보고 큐를 넣는다.
--   이미 만료된 이용권(end_date 과거)을 납부확인하면 트리거는 update_user(활성화)를 넣지만
--   회원 최종 상태는 expired 다 → CRM 은 만료인데 단말기는 열린다(출입통제 괴리).
-- 문제 2) 같은 트랜잭션에서 넣은 두 작업은 created_at 이 동일해(now() 고정)
--   처리 순서가 보장되지 않는다. 운 나쁘면 '활성화'가 나중에 처리된다.
-- 문제 3) 이미 미납인 건을 재차 미납 처리하면 트리거 전이 조건에 안 걸려 큐가 안 생겼다.
--
-- 해결: 최종 판정 직전에 그 회원의 pending 작업을 비우고 결론 1건만 넣는다.
--   processing/success/failed 기록은 건드리지 않는다(감사·재시도 이력 보존).
--
-- 실데이터 검증(2026-08-04): 만료납부→expired/disable, 유효납부→active/update,
--   정상→미납→unpaid/disable, 각 pending 1건. 3케이스 통과.

CREATE OR REPLACE FUNCTION public.enqueue_member_sync_final(_member_id uuid, _job_type sync_job_type)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE inserted int := 0;
BEGIN
  DELETE FROM device_sync_jobs
   WHERE target_member_id = _member_id
     AND status = 'pending';

  INSERT INTO device_sync_jobs (branch_id, device_id, job_type, target_member_id, status)
  SELECT d.branch_id, d.id, _job_type, _member_id, 'pending'
  FROM device_users du
  JOIN access_devices d ON d.id = du.device_id
  WHERE du.member_id = _member_id;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END $function$;

REVOKE EXECUTE ON FUNCTION public.enqueue_member_sync_final(uuid, sync_job_type) FROM PUBLIC, anon;

-- set_membership_paid / set_membership_unpaid 는 20260804050000 정의에
-- enqueue_member_sync_final 호출을 더한 형태다(운영 적용본과 동일).
-- 전문은 운영 DB 의 pg_get_functiondef 로 확인 가능하며,
-- 핵심 차이는 상태 확정 뒤 아래 한 줄이 실행된다는 점이다:
--   perform public.enqueue_member_sync_final(v_member_id, 'update_user' | 'disable_user');

-- ── 롤백 ────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.enqueue_member_sync_final(uuid, sync_job_type);
-- 그리고 두 RPC 를 20260804050000 버전으로 CREATE OR REPLACE (동기화 호출 제거)

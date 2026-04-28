-- Phase 6 마이그레이션: 출입권한 자동화
-- 1) enqueue_member_sync(): 회원의 모든 device_users 에 대해 sync_job INSERT
-- 2) memberships/trial_passes status 변경 트리거 → 자동 sync_job 생성
-- 3) expire_outdated_memberships() RPC: 일일 만료 처리 (Workers cron 호출)
-- 4) force_device_sync() RPC: CRM "강제 동기화" 버튼

-- ============================================================
-- 1) enqueue_member_sync helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_member_sync(
  _member_id uuid,
  _job_type sync_job_type
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted int := 0;
BEGIN
  INSERT INTO device_sync_jobs (branch_id, device_id, job_type, target_member_id, status)
  SELECT d.branch_id, d.id, _job_type, _member_id, 'pending'
  FROM device_users du
  JOIN access_devices d ON d.id = du.device_id
  WHERE du.member_id = _member_id;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END $$;

-- ============================================================
-- 2) memberships 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION public.memberships_sync_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- INSERT: active + paid/partial 면 업데이트 enqueue + members.status='active'
  IF TG_OP = 'INSERT' AND NEW.status = 'active' AND NEW.payment_status IN ('paid', 'partial') THEN
    PERFORM public.enqueue_member_sync(NEW.member_id, 'update_user');
    UPDATE members SET status = 'active'
      WHERE id = NEW.member_id AND status NOT IN ('suspended', 'withdrawn');
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- active → expired/paused/canceled: disable
    IF OLD.status = 'active' AND NEW.status IN ('expired', 'paused', 'canceled') THEN
      PERFORM public.enqueue_member_sync(NEW.member_id, 'disable_user');
      -- 다른 active 이용권이 없으면 members.status 갱신
      IF NOT EXISTS (
        SELECT 1 FROM memberships
         WHERE member_id = NEW.member_id
           AND id <> NEW.id
           AND status = 'active'
           AND payment_status IN ('paid', 'partial')
      ) THEN
        UPDATE members SET status = CASE
          WHEN NEW.status = 'paused' THEN 'suspended'
          ELSE 'expired'
        END
        WHERE id = NEW.member_id AND status NOT IN ('suspended', 'withdrawn');
      END IF;
      RETURN NEW;
    END IF;
    -- paid/partial → unpaid: disable + members.status='unpaid'
    IF OLD.payment_status IN ('paid', 'partial') AND NEW.payment_status = 'unpaid' THEN
      PERFORM public.enqueue_member_sync(NEW.member_id, 'disable_user');
      UPDATE members SET status = 'unpaid'
        WHERE id = NEW.member_id AND status = 'active';
      RETURN NEW;
    END IF;
    -- unpaid → paid/partial 그리고 active: re-enable
    IF OLD.payment_status = 'unpaid'
       AND NEW.payment_status IN ('paid', 'partial')
       AND NEW.status = 'active' THEN
      PERFORM public.enqueue_member_sync(NEW.member_id, 'update_user');
      UPDATE members SET status = 'active'
        WHERE id = NEW.member_id AND status = 'unpaid';
      RETURN NEW;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS memberships_sync_trigger ON memberships;
CREATE TRIGGER memberships_sync_trigger
  AFTER INSERT OR UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_sync_trigger();

-- ============================================================
-- 2b) trial_passes 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION public.trial_passes_sync_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    PERFORM public.enqueue_member_sync(NEW.member_id, 'update_user');
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'active'
     AND NEW.status IN ('used', 'expired', 'canceled') THEN
    -- 다른 active 이용권/체험권이 없으면 disable
    IF NOT EXISTS (
      SELECT 1 FROM memberships
       WHERE member_id = NEW.member_id
         AND status = 'active'
         AND payment_status IN ('paid', 'partial')
    ) AND NOT EXISTS (
      SELECT 1 FROM trial_passes
       WHERE member_id = NEW.member_id
         AND status = 'active'
         AND id <> NEW.id
    ) THEN
      PERFORM public.enqueue_member_sync(NEW.member_id, 'disable_user');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trial_passes_sync_trigger ON trial_passes;
CREATE TRIGGER trial_passes_sync_trigger
  AFTER INSERT OR UPDATE ON trial_passes
  FOR EACH ROW EXECUTE FUNCTION trial_passes_sync_trigger();

-- ============================================================
-- 3) expire_outdated_memberships() RPC — Workers daily cron 가 호출
-- ============================================================
CREATE OR REPLACE FUNCTION public.expire_outdated_memberships()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m_count int := 0;
  t_count int := 0;
  t_used  int := 0;
BEGIN
  -- 만료 이용권 (트리거가 disable_user enqueue 자동)
  WITH updated AS (
    UPDATE memberships SET status = 'expired'
     WHERE status = 'active' AND end_date < CURRENT_DATE
     RETURNING id
  )
  SELECT count(*) INTO m_count FROM updated;

  -- 만료 체험권
  WITH updated AS (
    UPDATE trial_passes SET status = 'expired'
     WHERE status = 'active' AND end_at < now()
     RETURNING id
  )
  SELECT count(*) INTO t_count FROM updated;

  -- 사용 횟수 소진 체험권
  WITH updated AS (
    UPDATE trial_passes SET status = 'used'
     WHERE status = 'active' AND used_entries >= max_entries
     RETURNING id
  )
  SELECT count(*) INTO t_used FROM updated;

  RETURN jsonb_build_object(
    'memberships_expired', m_count,
    'trials_expired', t_count,
    'trials_used_up', t_used,
    'ran_at', now()
  );
END $$;

-- ============================================================
-- 4) force_device_sync() RPC — CRM "강제 동기화" 버튼
-- ============================================================
CREATE OR REPLACE FUNCTION public.force_device_sync(_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  device_row access_devices%ROWTYPE;
  inserted int := 0;
  reset int := 0;
BEGIN
  SELECT * INTO device_row FROM access_devices WHERE id = _device_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  -- 권한: hq 또는 자기 지점 branch_admin 만
  IF NOT (
    public.is_hq_admin()
    OR (public.is_branch_admin() AND device_row.branch_id = public.current_branch_id())
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- 모든 device_users 를 update_user 로 enqueue
  INSERT INTO device_sync_jobs (branch_id, device_id, job_type, target_member_id, status)
  SELECT device_row.branch_id, device_row.id, 'update_user', du.member_id, 'pending'
  FROM device_users du
  WHERE du.device_id = device_row.id;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  -- 이 장비의 failed 작업을 retry 가능 상태로 리셋
  WITH updated AS (
    UPDATE device_sync_jobs
       SET status = 'pending', retry_count = 0, error_message = NULL
     WHERE device_id = device_row.id AND status = 'failed'
     RETURNING id
  )
  SELECT count(*) INTO reset FROM updated;

  -- device 가 error 상태였으면 active 로 복구 시도
  UPDATE access_devices SET status = 'active'
   WHERE id = device_row.id AND status = 'error';

  RETURN jsonb_build_object(
    'device_id', device_row.id,
    'jobs_created', inserted,
    'failed_reset', reset,
    'requested_at', now()
  );
END $$;

-- ============================================================
-- 권한 부여
-- ============================================================
GRANT EXECUTE ON FUNCTION public.enqueue_member_sync(uuid, sync_job_type) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_outdated_memberships() TO service_role;
GRANT EXECUTE ON FUNCTION public.force_device_sync(uuid) TO authenticated;

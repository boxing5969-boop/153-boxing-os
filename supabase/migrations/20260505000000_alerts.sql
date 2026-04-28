-- Phase 17 마이그레이션: 사고 알림 자동화
-- Workers cron 5분마다 run_alert_check() 호출 → 신규 알림 INSERT (중복 방지) + 회복된 알림 resolve.
-- 새로 생성된 알림을 반환하면 Workers 가 Slack webhook 으로 발송 후 mark_alert_notified.

CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');

CREATE TYPE alert_kind AS ENUM (
  'device_offline',
  'device_error',
  'sync_backlog'
);

CREATE TABLE alert_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         alert_kind NOT NULL,
  severity     alert_severity NOT NULL DEFAULT 'warning',
  branch_id    uuid REFERENCES branches(id) ON DELETE SET NULL,
  device_id    uuid REFERENCES access_devices(id) ON DELETE SET NULL,
  subject      text NOT NULL,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at  timestamptz NOT NULL DEFAULT now(),
  notified_at  timestamptz,
  resolved_at  timestamptz,
  CONSTRAINT alert_events_resolved_after_detected
    CHECK (resolved_at IS NULL OR resolved_at >= detected_at)
);

CREATE INDEX idx_alerts_unresolved
  ON alert_events(kind, branch_id, device_id)
  WHERE resolved_at IS NULL;
CREATE INDEX idx_alerts_recent ON alert_events(detected_at DESC);
CREATE INDEX idx_alerts_pending_notify
  ON alert_events(detected_at)
  WHERE notified_at IS NULL AND resolved_at IS NULL;

ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY alerts_hq_select ON alert_events
  FOR SELECT TO authenticated USING (is_hq_admin());
CREATE POLICY alerts_branch_select ON alert_events
  FOR SELECT TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id());

-- ============================================================
-- run_alert_check() — Workers cron 진입점
-- ============================================================
CREATE OR REPLACE FUNCTION public.run_alert_check(_offline_minutes int DEFAULT 30)
RETURNS TABLE (
  alert_id uuid,
  kind alert_kind,
  severity alert_severity,
  subject text,
  details jsonb,
  branch_id uuid,
  device_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ============================================================
  -- DETECT new alert conditions (skip if active alert already exists)
  -- ============================================================

  -- 1) device_offline: status='active' AND last_seen_at > threshold (or NULL + old)
  INSERT INTO alert_events (kind, severity, branch_id, device_id, subject, details)
  SELECT
    'device_offline',
    'warning'::alert_severity,
    d.branch_id,
    d.id,
    d.device_name || ' 통신 두절 (' || _offline_minutes || '분 이상)',
    jsonb_build_object(
      'last_seen_at', d.last_seen_at,
      'threshold_minutes', _offline_minutes,
      'vendor', d.vendor::text
    )
  FROM access_devices d
  WHERE d.status = 'active'
    AND (
      (d.last_seen_at IS NULL AND d.created_at < now() - make_interval(mins => _offline_minutes))
      OR d.last_seen_at < now() - make_interval(mins => _offline_minutes)
    )
    AND NOT EXISTS (
      SELECT 1 FROM alert_events a
       WHERE a.kind = 'device_offline'
         AND a.device_id = d.id
         AND a.resolved_at IS NULL
    );

  -- 2) device_error: status='error' (sync 5회 실패 후 자동 전환)
  INSERT INTO alert_events (kind, severity, branch_id, device_id, subject, details)
  SELECT
    'device_error',
    'critical'::alert_severity,
    d.branch_id,
    d.id,
    d.device_name || ' 동기화 오류 상태',
    jsonb_build_object('vendor', d.vendor::text)
  FROM access_devices d
  WHERE d.status = 'error'
    AND NOT EXISTS (
      SELECT 1 FROM alert_events a
       WHERE a.kind = 'device_error'
         AND a.device_id = d.id
         AND a.resolved_at IS NULL
    );

  -- 3) sync_backlog: failed 작업이 device 별로 10건 이상 누적
  INSERT INTO alert_events (kind, severity, branch_id, device_id, subject, details)
  SELECT
    'sync_backlog',
    'warning'::alert_severity,
    d.branch_id,
    d.id,
    d.device_name || ' 동기화 실패 누적 (' || failed.cnt::text || '건)',
    jsonb_build_object('failed_count', failed.cnt)
  FROM (
    SELECT j.device_id, count(*) AS cnt
    FROM device_sync_jobs j
    WHERE j.status = 'failed'
    GROUP BY j.device_id
    HAVING count(*) >= 10
  ) failed
  JOIN access_devices d ON d.id = failed.device_id
  WHERE NOT EXISTS (
    SELECT 1 FROM alert_events a
     WHERE a.kind = 'sync_backlog'
       AND a.device_id = d.id
       AND a.resolved_at IS NULL
  );

  -- ============================================================
  -- RESOLVE conditions that have recovered
  -- ============================================================

  UPDATE alert_events SET resolved_at = now()
  WHERE kind = 'device_offline'
    AND resolved_at IS NULL
    AND device_id IN (
      SELECT id FROM access_devices
       WHERE last_seen_at IS NOT NULL
         AND last_seen_at >= now() - make_interval(mins => _offline_minutes)
    );

  UPDATE alert_events SET resolved_at = now()
  WHERE kind = 'device_error'
    AND resolved_at IS NULL
    AND device_id IN (SELECT id FROM access_devices WHERE status <> 'error');

  UPDATE alert_events SET resolved_at = now()
  WHERE kind = 'sync_backlog'
    AND resolved_at IS NULL
    AND (
      device_id IS NULL
      OR device_id NOT IN (
        SELECT device_id FROM device_sync_jobs
         WHERE status = 'failed'
         GROUP BY device_id
         HAVING count(*) >= 10
      )
    );

  -- ============================================================
  -- RETURN newly inserted (unnotified, unresolved) alerts
  -- ============================================================
  RETURN QUERY
    SELECT a.id, a.kind, a.severity, a.subject, a.details, a.branch_id, a.device_id
    FROM alert_events a
    WHERE a.notified_at IS NULL
      AND a.resolved_at IS NULL
    ORDER BY a.detected_at ASC
    LIMIT 100;
END $$;

-- ============================================================
-- mark_alert_notified — Workers 발송 후 호출
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_alert_notified(_alert_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE alert_events SET notified_at = now() WHERE id = _alert_id;
$$;

GRANT EXECUTE ON FUNCTION public.run_alert_check(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_alert_notified(uuid) TO service_role;

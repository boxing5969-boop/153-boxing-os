-- ============================================================
-- Fix: run_alert_check "column reference kind is ambiguous"
-- ============================================================
-- 원인: RETURNS TABLE(... kind alert_kind, ... device_id uuid) 의 출력
--       컬럼명이 alert_events 테이블 컬럼명과 충돌. UPDATE 문의
--       미한정 WHERE kind = ... / device_id IN ... 가 모호하게 해석됨.
-- 해결: 함수 본문 첫 줄에 #variable_conflict use_column 지시어를 추가해
--       미한정 참조를 항상 테이블 컬럼으로 해석.
-- ============================================================

CREATE OR REPLACE FUNCTION public.run_alert_check(_offline_minutes integer DEFAULT 30)
 RETURNS TABLE(alert_id uuid, kind alert_kind, severity alert_severity, subject text, details jsonb, branch_id uuid, device_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  INSERT INTO alert_events (kind, severity, branch_id, device_id, subject, details)
  SELECT
    'device_offline', 'warning'::alert_severity, d.branch_id, d.id,
    d.device_name || ' 통신 두절 (' || _offline_minutes || '분 이상)',
    jsonb_build_object('last_seen_at', d.last_seen_at,
      'threshold_minutes', _offline_minutes, 'vendor', d.vendor::text)
  FROM access_devices d
  WHERE d.status = 'active'
    AND ((d.last_seen_at IS NULL AND d.created_at < now() - make_interval(mins => _offline_minutes))
         OR d.last_seen_at < now() - make_interval(mins => _offline_minutes))
    AND NOT EXISTS (SELECT 1 FROM alert_events a
       WHERE a.kind = 'device_offline' AND a.device_id = d.id AND a.resolved_at IS NULL);

  INSERT INTO alert_events (kind, severity, branch_id, device_id, subject, details)
  SELECT
    'device_error', 'critical'::alert_severity, d.branch_id, d.id,
    d.device_name || ' 동기화 오류 상태',
    jsonb_build_object('vendor', d.vendor::text)
  FROM access_devices d
  WHERE d.status = 'error'
    AND NOT EXISTS (SELECT 1 FROM alert_events a
       WHERE a.kind = 'device_error' AND a.device_id = d.id AND a.resolved_at IS NULL);

  INSERT INTO alert_events (kind, severity, branch_id, device_id, subject, details)
  SELECT
    'sync_backlog', 'warning'::alert_severity, d.branch_id, d.id,
    d.device_name || ' 동기화 실패 누적 (' || failed.cnt::text || '건)',
    jsonb_build_object('failed_count', failed.cnt)
  FROM (SELECT j.device_id, count(*) AS cnt FROM device_sync_jobs j
        WHERE j.status = 'failed' GROUP BY j.device_id HAVING count(*) >= 10) failed
  JOIN access_devices d ON d.id = failed.device_id
  WHERE NOT EXISTS (SELECT 1 FROM alert_events a
    WHERE a.kind = 'sync_backlog' AND a.device_id = d.id AND a.resolved_at IS NULL);

  UPDATE alert_events SET resolved_at = now()
  WHERE kind = 'device_offline' AND resolved_at IS NULL
    AND device_id IN (SELECT id FROM access_devices
       WHERE last_seen_at IS NOT NULL
         AND last_seen_at >= now() - make_interval(mins => _offline_minutes));

  UPDATE alert_events SET resolved_at = now()
  WHERE kind = 'device_error' AND resolved_at IS NULL
    AND device_id IN (SELECT id FROM access_devices WHERE status <> 'error');

  UPDATE alert_events SET resolved_at = now()
  WHERE kind = 'sync_backlog' AND resolved_at IS NULL
    AND (device_id IS NULL OR device_id NOT IN (
        SELECT device_id FROM device_sync_jobs
         WHERE status = 'failed' GROUP BY device_id HAVING count(*) >= 10));

  RETURN QUERY
    SELECT a.id, a.kind, a.severity, a.subject, a.details, a.branch_id, a.device_id
    FROM alert_events a
    WHERE a.notified_at IS NULL AND a.resolved_at IS NULL
    ORDER BY a.detected_at ASC
    LIMIT 100;
END $function$;

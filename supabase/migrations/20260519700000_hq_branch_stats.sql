-- ============================================================
-- Phase 7: 본사 대시보드 — 지점별 핵심 지표 함수
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_hq_branch_stats()
RETURNS TABLE (
  branch_id      UUID,
  branch_name    TEXT,
  active_members BIGINT,
  today_access   BIGINT,
  today_denied   BIGINT,
  expiring_7d    BIGINT,
  unpaid_members BIGINT,
  failed_sync    BIGINT
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.name,
    (SELECT COUNT(*) FROM members m
     WHERE m.branch_id = b.id AND m.status = 'active'),
    (SELECT COUNT(*) FROM access_logs al
     WHERE al.branch_id = b.id AND al.result = 'success'
       AND al.occurred_at >= CURRENT_DATE::TIMESTAMPTZ),
    (SELECT COUNT(*) FROM access_logs al
     WHERE al.branch_id = b.id AND al.result = 'denied'
       AND al.occurred_at >= CURRENT_DATE::TIMESTAMPTZ),
    (SELECT COUNT(*) FROM memberships ms
     WHERE ms.branch_id = b.id AND ms.status = 'active'
       AND ms.end_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days')),
    (SELECT COUNT(*) FROM members m
     WHERE m.branch_id = b.id AND m.status = 'unpaid'),
    (SELECT COUNT(*) FROM device_sync_jobs dsj
     WHERE dsj.branch_id = b.id AND dsj.status = 'failed')
  FROM branches b
  WHERE b.status = 'active'
  ORDER BY b.name;
$$;

GRANT EXECUTE ON FUNCTION public.get_hq_branch_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_hq_branch_stats() TO authenticated;

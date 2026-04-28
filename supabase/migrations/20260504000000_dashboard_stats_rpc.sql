-- Phase 14 마이그레이션: 대시보드 분석 RPC
-- 거절 사유 분포 (지점별 RLS 적용 — hq 전체 / branch_admin 자기 지점)

CREATE OR REPLACE FUNCTION public.get_denied_reason_stats(_days int DEFAULT 7)
RETURNS TABLE (denied_reason text, count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_branch uuid;
  is_hq boolean;
BEGIN
  is_hq := public.is_hq_admin();
  IF NOT is_hq THEN
    caller_branch := public.current_branch_id();
    IF caller_branch IS NULL THEN
      RETURN; -- 권한 없으면 빈 결과
    END IF;
  END IF;

  IF _days < 1 OR _days > 90 THEN
    _days := 7;
  END IF;

  RETURN QUERY
  SELECT al.denied_reason::text, count(*)::bigint
  FROM access_logs al
  WHERE al.result = 'denied'
    AND al.occurred_at >= now() - make_interval(days => _days)
    AND al.denied_reason IS NOT NULL
    AND (is_hq OR al.branch_id = caller_branch)
  GROUP BY al.denied_reason
  ORDER BY count(*) DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.get_denied_reason_stats(int) TO authenticated;

-- ============================================================
-- Phase 5: 이탈 위험 회원 + 일일 리포트 통계 함수
-- ============================================================

-- ── 1. 이탈 위험 회원 조회 ────────────────────────────────────
-- risk_type: 'unpaid' | 'expired' | 'absent'
CREATE OR REPLACE FUNCTION public.get_at_risk_members(_branch_id UUID)
RETURNS TABLE (
  member_id   UUID,
  member_name TEXT,
  member_phone TEXT,
  risk_type   TEXT,
  detail      TEXT,
  since_date  DATE
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  -- 미납 회원
  SELECT
    m.id,
    m.name,
    m.phone,
    'unpaid'::TEXT AS risk_type,
    '미납 처리됨'  AS detail,
    CURRENT_DATE   AS since_date
  FROM members m
  WHERE m.branch_id = _branch_id
    AND m.status = 'unpaid'

  UNION ALL

  -- 만료 후 30일 이내 미재등록
  SELECT DISTINCT ON (m.id)
    m.id,
    m.name,
    m.phone,
    'expired'::TEXT        AS risk_type,
    '만료 후 재등록 없음'    AS detail,
    ms.end_date::DATE      AS since_date
  FROM members m
  JOIN memberships ms ON ms.member_id = m.id
    AND ms.status = 'expired'
    AND ms.end_date >= (CURRENT_DATE - INTERVAL '30 days')
    AND ms.end_date <  CURRENT_DATE
  WHERE m.branch_id = _branch_id
    AND m.status    = 'expired'
    AND NOT EXISTS (
      SELECT 1 FROM memberships ms2
      WHERE ms2.member_id = m.id AND ms2.status = 'active'
    )

  UNION ALL

  -- 장기 미출석: active 회원이지만 14일 이상 출입 없음
  SELECT
    m.id,
    m.name,
    m.phone,
    'absent'::TEXT              AS risk_type,
    '14일 이상 미출석'            AS detail,
    DATE(last_access.last_seen) AS since_date
  FROM members m
  JOIN (
    SELECT member_id, MAX(occurred_at) AS last_seen
    FROM access_logs
    WHERE branch_id = _branch_id
      AND result    = 'success'
    GROUP BY member_id
    HAVING MAX(occurred_at) < NOW() - INTERVAL '14 days'
  ) last_access ON last_access.member_id = m.id
  WHERE m.branch_id = _branch_id
    AND m.status    = 'active'
    AND EXISTS (
      SELECT 1 FROM memberships ms
      WHERE ms.member_id = m.id AND ms.status = 'active'
    )

  ORDER BY since_date ASC
  LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION public.get_at_risk_members(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_at_risk_members(UUID) TO authenticated;

-- ── 2. 일일 리포트 통계 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_daily_report_stats(_branch_id UUID)
RETURNS TABLE (
  today_success BIGINT,
  today_denied  BIGINT,
  expiring_7d   BIGINT,
  unpaid_count  BIGINT,
  new_today     BIGINT
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM access_logs
     WHERE branch_id   = _branch_id
       AND result      = 'success'
       AND occurred_at >= CURRENT_DATE::TIMESTAMPTZ),
    (SELECT COUNT(*) FROM access_logs
     WHERE branch_id   = _branch_id
       AND result      = 'denied'
       AND occurred_at >= CURRENT_DATE::TIMESTAMPTZ),
    (SELECT COUNT(*) FROM memberships
     WHERE branch_id = _branch_id
       AND status    = 'active'
       AND end_date  BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days')),
    (SELECT COUNT(*) FROM members
     WHERE branch_id = _branch_id
       AND status    = 'unpaid'),
    (SELECT COUNT(*) FROM members
     WHERE branch_id = _branch_id
       AND created_at >= CURRENT_DATE::TIMESTAMPTZ);
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_report_stats(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_report_stats(UUID) TO authenticated;

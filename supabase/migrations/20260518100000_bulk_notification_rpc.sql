-- ============================================================
-- 그룹 발송용 RPC: 만료 N일 이내 마케팅 동의 회원 조회
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_bulk_notification_targets(
  _days_ahead int,
  _branch_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  member_id      uuid,
  membership_id  uuid,
  member_name    text,
  plan_name      text,
  end_date       date,
  days_left      int,
  branch_id      uuid,
  branch_name    text,
  member_phone   text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id                              AS member_id,
    ms.id                             AS membership_id,
    m.name                            AS member_name,
    ms.plan_name,
    ms.end_date,
    (ms.end_date - CURRENT_DATE)::int AS days_left,
    b.id                              AS branch_id,
    b.name                            AS branch_name,
    m.phone                           AS member_phone
  FROM memberships ms
  JOIN members m  ON m.id  = ms.member_id
  JOIN branches b ON b.id  = m.branch_id
  JOIN consent_records cr
    ON cr.member_id    = m.id
   AND cr.consent_type = 'marketing'
   AND cr.agreed       = true
   AND cr.revoked_at  IS NULL
  WHERE
    ms.status = 'active'
    AND ms.payment_status IN ('paid', 'partial')
    AND ms.end_date >= CURRENT_DATE
    AND ms.end_date <= CURRENT_DATE + _days_ahead
    AND m.phone IS NOT NULL AND m.phone <> ''
    AND (_branch_id IS NULL OR b.id = _branch_id)
  ORDER BY ms.end_date, b.name, m.name
$$;

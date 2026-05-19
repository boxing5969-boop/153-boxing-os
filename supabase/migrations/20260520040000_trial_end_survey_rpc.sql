-- ============================================================
-- Survey Phase 5: 체험권 종료 설문 발송 대상 조회 RPC
-- 목적 : 어제 만료된 체험권 소지자 중 마케팅 동의 + 전화번호 보유 회원 반환
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_trial_end_survey_targets()
RETURNS TABLE (
  member_id    UUID,
  member_name  TEXT,
  member_phone TEXT,
  branch_id    UUID,
  branch_name  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    m.id                AS member_id,
    m.name              AS member_name,
    m.phone             AS member_phone,
    m.branch_id         AS branch_id,
    b.name              AS branch_name
  FROM public.trial_passes tp
  JOIN public.members m ON m.id = tp.member_id
  JOIN public.branches b ON b.id = m.branch_id
  WHERE
    -- 어제 만료된 체험권
    tp.status = 'expired'
    AND tp.end_at::date = (CURRENT_DATE - INTERVAL '1 day')::date
    -- 전화번호 존재
    AND m.phone IS NOT NULL AND m.phone <> ''
    -- 마케팅 동의
    AND EXISTS (
      SELECT 1 FROM public.consent_records cr
      WHERE cr.member_id = m.id
        AND cr.consent_type = 'marketing'
        AND cr.agreed = true
        AND cr.revoked_at IS NULL
    )
    -- 오늘 이미 발송된 경우 제외
    AND NOT EXISTS (
      SELECT 1 FROM public.message_send_logs sl
      WHERE sl.member_id = m.id
        AND sl.trigger_type = 'trial_end'
        AND sl.status = 'sent'
        AND sl.sent_at::date = CURRENT_DATE
    )
  ORDER BY b.name, m.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_trial_end_survey_targets() TO service_role;

DO $$
BEGIN
  RAISE NOTICE 'get_trial_end_survey_targets RPC created';
END;
$$;

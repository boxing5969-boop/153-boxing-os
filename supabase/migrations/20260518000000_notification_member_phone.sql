-- ============================================================
-- 알림 발송 대상: 관장 번호 → 회원 본인 번호로 변경
-- - membership_notifications.recipient_phone 컬럼 추가
-- - get_expiry_notification_targets(): member_phone 반환 + 마케팅 동의 필터
-- - record_expiry_notification(): _recipient_phone 파라미터 추가
-- ============================================================

-- 1) recipient_phone 컬럼 추가
ALTER TABLE public.membership_notifications
  ADD COLUMN IF NOT EXISTS recipient_phone text;

-- 2) 기존 함수 DROP (리턴 타입 변경)
DROP FUNCTION IF EXISTS public.get_expiry_notification_targets();

CREATE OR REPLACE FUNCTION public.get_expiry_notification_targets()
RETURNS TABLE (
  member_id         uuid,
  membership_id     uuid,
  member_name       text,
  plan_name         text,
  end_date          date,
  days_left         int,
  notification_type text,
  branch_id         uuid,
  branch_name       text,
  member_phone      text
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
    CASE (ms.end_date - CURRENT_DATE)::int
      WHEN 7 THEN 'expiry_d7'
      WHEN 3 THEN 'expiry_d3'
      WHEN 1 THEN 'expiry_d1'
    END                               AS notification_type,
    b.id                              AS branch_id,
    b.name                            AS branch_name,
    m.phone                           AS member_phone
  FROM memberships ms
  JOIN members m  ON m.id  = ms.member_id
  JOIN branches b ON b.id  = m.branch_id
  -- 마케팅 동의한 회원만 발송
  JOIN consent_records cr
    ON cr.member_id    = m.id
   AND cr.consent_type = 'marketing'
   AND cr.agreed       = true
   AND cr.revoked_at  IS NULL
  WHERE
    ms.status = 'active'
    AND ms.payment_status IN ('paid', 'partial')
    AND ms.end_date - CURRENT_DATE IN (7, 3, 1)
    AND m.phone IS NOT NULL AND m.phone <> ''
    AND NOT EXISTS (
      SELECT 1 FROM membership_notifications mn
       WHERE mn.membership_id     = ms.id
         AND mn.notification_type = CASE (ms.end_date - CURRENT_DATE)::int
                                      WHEN 7 THEN 'expiry_d7'
                                      WHEN 3 THEN 'expiry_d3'
                                      WHEN 1 THEN 'expiry_d1'
                                    END
         AND mn.status = 'sent'
    )
  ORDER BY ms.end_date, b.name, m.name
$$;

-- 3) record_expiry_notification() 재정의 — recipient_phone 파라미터 추가
CREATE OR REPLACE FUNCTION public.record_expiry_notification(
  _member_id         uuid,
  _membership_id     uuid,
  _notification_type text,
  _status            text DEFAULT 'sent',
  _error_message     text DEFAULT NULL,
  _recipient_phone   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  INSERT INTO membership_notifications
    (member_id, membership_id, notification_type, status, error_message, recipient_phone)
  VALUES
    (_member_id, _membership_id, _notification_type, _status, _error_message, _recipient_phone)
  ON CONFLICT (membership_id, notification_type)
  DO UPDATE SET
    status          = EXCLUDED.status,
    error_message   = EXCLUDED.error_message,
    recipient_phone = EXCLUDED.recipient_phone,
    sent_at         = now()
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

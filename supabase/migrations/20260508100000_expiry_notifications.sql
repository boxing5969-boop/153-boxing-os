-- ============================================================
-- 알림톡 발송 기록 테이블 + 만료 알림 대상 조회 함수
-- ============================================================

-- 1) membership_notifications — 중복 발송 방지용 이력
-- ============================================================
CREATE TABLE IF NOT EXISTS public.membership_notifications (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        uuid        NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  membership_id    uuid        REFERENCES public.memberships(id) ON DELETE SET NULL,
  notification_type text       NOT NULL, -- 'expiry_d7' | 'expiry_d3' | 'expiry_d1'
  sent_at          timestamptz NOT NULL DEFAULT now(),
  status           text        NOT NULL DEFAULT 'sent', -- 'sent' | 'failed'
  error_message    text,
  UNIQUE (membership_id, notification_type)
);

CREATE INDEX IF NOT EXISTS membership_notifications_member_id_idx
  ON public.membership_notifications (member_id);
CREATE INDEX IF NOT EXISTS membership_notifications_sent_at_idx
  ON public.membership_notifications (sent_at DESC);

-- RLS
ALTER TABLE public.membership_notifications ENABLE ROW LEVEL SECURITY;
-- service_role 만 접근 (Workers cron 전용)

-- 2) get_expiry_notification_targets() — 오늘 알림을 보내야 할 이용권 목록
-- ============================================================
-- D-7 / D-3 / D-1: end_date 가 오늘로부터 정확히 해당일 남은 이용권
-- 조건: active + paid/partial + phone 존재 + 아직 해당 타입 알림 미발송
CREATE OR REPLACE FUNCTION public.get_expiry_notification_targets()
RETURNS TABLE (
  member_id        uuid,
  membership_id    uuid,
  member_name      text,
  member_phone     text,
  plan_name        text,
  end_date         date,
  days_left        int,
  notification_type text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id            AS member_id,
    ms.id           AS membership_id,
    m.name          AS member_name,
    m.phone         AS member_phone,
    ms.plan_name,
    ms.end_date,
    (ms.end_date - CURRENT_DATE)::int AS days_left,
    CASE (ms.end_date - CURRENT_DATE)::int
      WHEN 7 THEN 'expiry_d7'
      WHEN 3 THEN 'expiry_d3'
      WHEN 1 THEN 'expiry_d1'
    END AS notification_type
  FROM memberships ms
  JOIN members m ON m.id = ms.member_id
  WHERE
    ms.status = 'active'
    AND ms.payment_status IN ('paid', 'partial')
    AND ms.end_date - CURRENT_DATE IN (7, 3, 1)
    AND m.phone IS NOT NULL
    AND m.phone <> ''
    -- 이미 발송된 타입 제외
    AND NOT EXISTS (
      SELECT 1 FROM membership_notifications mn
       WHERE mn.membership_id = ms.id
         AND mn.notification_type = CASE (ms.end_date - CURRENT_DATE)::int
                                      WHEN 7 THEN 'expiry_d7'
                                      WHEN 3 THEN 'expiry_d3'
                                      WHEN 1 THEN 'expiry_d1'
                                    END
         AND mn.status = 'sent'
    )
  ORDER BY ms.end_date, m.name
$$;

-- 3) record_expiry_notification() — Workers 에서 발송 후 기록
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_expiry_notification(
  _member_id        uuid,
  _membership_id    uuid,
  _notification_type text,
  _status           text DEFAULT 'sent',
  _error_message    text DEFAULT NULL
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
    (member_id, membership_id, notification_type, status, error_message)
  VALUES
    (_member_id, _membership_id, _notification_type, _status, _error_message)
  ON CONFLICT (membership_id, notification_type)
    DO UPDATE SET
      status        = EXCLUDED.status,
      error_message = EXCLUDED.error_message,
      sent_at       = now()
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- 권한
GRANT EXECUTE ON FUNCTION public.get_expiry_notification_targets() TO service_role;
GRANT EXECUTE ON FUNCTION public.record_expiry_notification(uuid, uuid, text, text, text) TO service_role;
GRANT ALL ON TABLE public.membership_notifications TO service_role;
GRANT USAGE ON SEQUENCE public.membership_notifications_id_seq TO service_role;

-- ============================================================
-- 통합 메시징 시스템 (SMS + 카카오, 자동/예약/수동 발송)
-- ============================================================

-- 1) branches에 SMS + 알림 설정 컬럼 추가
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS sms_sender_phone   text,
  ADD COLUMN IF NOT EXISTS notify_channel     text NOT NULL DEFAULT 'kakao'
    CHECK (notify_channel IN ('sms','kakao','both','kakao_sms_fallback')),
  ADD COLUMN IF NOT EXISTS notify_triggers    jsonb NOT NULL DEFAULT '["expiry_d7","expiry_d3","expiry_d1"]'::jsonb;

-- 2) 메시지 템플릿
CREATE TABLE IF NOT EXISTS public.message_templates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  content      text        NOT NULL,
  channel      text        NOT NULL DEFAULT 'sms'
    CHECK (channel IN ('sms','kakao','both','kakao_sms_fallback')),
  trigger_type text
    CHECK (trigger_type IN ('expiry_d7','expiry_d3','expiry_d1','expiry_d0','expiry_d_plus_7','manual')),
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_templates_branch_id_idx ON public.message_templates (branch_id);
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

-- 3) 예약 발송
CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id           uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  content             text        NOT NULL,
  channel             text        NOT NULL DEFAULT 'sms'
    CHECK (channel IN ('sms','kakao','both','kakao_sms_fallback')),
  target_type         text        NOT NULL DEFAULT 'group'
    CHECK (target_type IN ('member','group')),
  target_member_id    uuid        REFERENCES public.members(id) ON DELETE CASCADE,
  target_days_ahead   int,
  scheduled_at        timestamptz NOT NULL,
  status              text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','failed','cancelled')),
  sent_count          int         NOT NULL DEFAULT 0,
  fail_count          int         NOT NULL DEFAULT 0,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);

CREATE INDEX IF NOT EXISTS scheduled_messages_branch_id_idx   ON public.scheduled_messages (branch_id);
CREATE INDEX IF NOT EXISTS scheduled_messages_scheduled_at_idx ON public.scheduled_messages (scheduled_at)
  WHERE status = 'pending';
ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;

-- 4) 발송 이력 (SMS + 카카오 통합)
CREATE TABLE IF NOT EXISTS public.message_send_logs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        uuid        REFERENCES public.branches(id),
  member_id        uuid        REFERENCES public.members(id),
  scheduled_msg_id uuid        REFERENCES public.scheduled_messages(id) ON DELETE SET NULL,
  channel          text        NOT NULL CHECK (channel IN ('sms','kakao')),
  recipient_phone  text,
  content_preview  text,
  trigger_type     text,
  status           text        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed')),
  error_message    text,
  sent_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_send_logs_branch_id_idx ON public.message_send_logs (branch_id);
CREATE INDEX IF NOT EXISTS message_send_logs_member_id_idx ON public.message_send_logs (member_id);
CREATE INDEX IF NOT EXISTS message_send_logs_sent_at_idx   ON public.message_send_logs (sent_at DESC);
ALTER TABLE public.message_send_logs ENABLE ROW LEVEL SECURITY;

-- 5) 예약 발송 대기 조회 RPC
CREATE OR REPLACE FUNCTION public.get_due_scheduled_messages()
RETURNS TABLE (
  id               uuid,
  branch_id        uuid,
  name             text,
  content          text,
  channel          text,
  target_type      text,
  target_member_id uuid,
  target_days_ahead int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, branch_id, name, content, channel, target_type, target_member_id, target_days_ahead
  FROM scheduled_messages
  WHERE status = 'pending' AND scheduled_at <= now()
  ORDER BY scheduled_at
  LIMIT 20
$$;

-- 6) D-0 / D+7 대상 조회 RPC
CREATE OR REPLACE FUNCTION public.get_expiry_trigger_targets(_trigger_type text)
RETURNS TABLE (
  member_id uuid, membership_id uuid, member_name text,
  plan_name text, end_date date, days_left int,
  branch_id uuid, branch_name text, member_phone text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.id, ms.id, m.name, ms.plan_name, ms.end_date,
    (ms.end_date - CURRENT_DATE)::int,
    b.id, b.name, m.phone
  FROM memberships ms
  JOIN members m ON m.id = ms.member_id
  JOIN branches b ON b.id = m.branch_id
  JOIN consent_records cr
    ON cr.member_id = m.id AND cr.consent_type = 'marketing'
   AND cr.agreed = true AND cr.revoked_at IS NULL
  WHERE
    m.phone IS NOT NULL AND m.phone <> ''
    AND (
      (_trigger_type = 'expiry_d0'        AND ms.end_date = CURRENT_DATE     AND ms.status IN ('active','expired'))
   OR (_trigger_type = 'expiry_d_plus_7'  AND ms.end_date = CURRENT_DATE - 7 AND ms.status = 'expired')
    )
    AND NOT EXISTS (
      SELECT 1 FROM membership_notifications mn
       WHERE mn.membership_id = ms.id AND mn.notification_type = _trigger_type AND mn.status = 'sent'
    )
  ORDER BY b.name, m.name
$$;

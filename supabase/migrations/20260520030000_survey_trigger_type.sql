-- ============================================================
-- Survey Phase 5: message_templates trigger_type에 trial_end 추가
-- ============================================================

-- 기존 CHECK 제약 삭제 후 재생성 (trial_end 포함)
ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_trigger_type_check;

ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_trigger_type_check
  CHECK (trigger_type IN (
    'expiry_d7',
    'expiry_d3',
    'expiry_d1',
    'expiry_d0',
    'expiry_d_plus_7',
    'trial_end',
    'manual'
  ));

DO $$
BEGIN
  RAISE NOTICE 'message_templates trigger_type CHECK updated (trial_end added)';
END;
$$;

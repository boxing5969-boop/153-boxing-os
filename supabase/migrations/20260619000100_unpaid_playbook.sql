-- ============================================================
-- 메시징 자동화 1단계 — 미납 회원 결제 안내 플레이북
-- ============================================================
-- compute_member_snapshots 가 이미 미납 회원에게 'unpaid_member' 세그먼트를
-- 자동 배정한다(함수 수정 불필요). 이 세그먼트를 트리거로 결제 안내 메시지를
-- 생성하는 플레이북을 추가한다.
--   run_playbooks: trigger_segment 로 member_segments 를 매칭 → generate_message
--   step(template_segment_key='unpaid_notice') → message_suggestions(draft) 생성
--   → 워커가 정보성(auto)으로 자동발송.
-- 멱등: 같은 company+name 이 있으면 건너뜀. 구조 변경 없음(데이터).
-- ============================================================

DO $$
DECLARE
  v_company uuid := (SELECT id FROM public.companies ORDER BY created_at LIMIT 1);
  v_rule    uuid;
BEGIN
  IF v_company IS NULL THEN RAISE NOTICE 'company 없음 — 시드 중단'; RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.playbook_rules
                 WHERE company_id = v_company AND name = '미납 회원 결제 안내') THEN
    INSERT INTO public.playbook_rules (company_id, name, description, trigger_segment, conditions, priority)
    VALUES (v_company, '미납 회원 결제 안내',
            '미납 상태 회원에게 결제 안내 문자를 발송(정보성·자동)', 'unpaid_member',
            '{"payment_status":"unpaid"}'::jsonb, 'high')
    RETURNING id INTO v_rule;

    INSERT INTO public.playbook_steps
      (playbook_rule_id, step_order, action_type, task_type, delay_days, condition, template_segment_key, description)
    VALUES
      (v_rule, 1, 'generate_message', NULL, 0, '{}'::jsonb, 'unpaid_notice', '미납 결제 안내 메시지 생성');
  END IF;

  RAISE NOTICE '메시징 1단계: 미납 플레이북 완료 (company=%)', v_company;
END $$;

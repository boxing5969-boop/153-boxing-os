-- ============================================================
-- 메시징 자동화 1단계 — message_templates 시드 (정중한 존댓말)
-- ============================================================
-- 기존 플레이북(run_playbooks)이 참조하지만 비어 있던 template_segment_key 를 채운다:
--   winback_boxing / praise_return / praise_consistent / pt_next_goal
-- + 미납 안내(unpaid_notice, 2번 마이그레이션의 플레이북이 사용)
--
-- 규약/제약 (DB check constraint 준수):
--  - 변수는 기존 substituteVars 규약과 동일한 #{회원명} #{지점명} 형식. (#{지점전화}는 워커 personalize 가 치환)
--  - channel='sms'. tone 은 soft/friendly/motivational/professional 만 허용 → 'professional'(정중).
--  - trigger_type 은 expiry_*/trial_end/manual 만 허용 → 'manual'. (플레이북 매칭은 segment_key 로 함)
--  - company_id 는 run_playbooks 의 템플릿 매칭에 필수.
--  - variables.is_ad/mode = 워커 발송 라우팅 힌트(정보성 auto / 그 외 review).
--  - 멱등: 같은 company_id+segment_key 가 이미 있으면 건너뜀. 구조 변경 없음(데이터 시드). 1지점(강남)부터.
-- ============================================================

DO $$
DECLARE
  v_company uuid := (SELECT id FROM public.companies ORDER BY created_at LIMIT 1);
  v_branch  uuid := (SELECT id FROM public.branches
                      WHERE name ILIKE '%강남%' AND deleted_at IS NULL
                      ORDER BY created_at LIMIT 1);
BEGIN
  IF v_company IS NULL THEN RAISE NOTICE 'company 없음 — 시드 중단'; RETURN; END IF;

  -- 1) 미납 안내 (정보성 · 자동발송)
  IF NOT EXISTS (SELECT 1 FROM public.message_templates
                 WHERE company_id = v_company AND segment_key = 'unpaid_notice' AND deleted_at IS NULL) THEN
    INSERT INTO public.message_templates
      (company_id, branch_id, name, content, channel, trigger_type, segment_key, product_type, lifecycle_stage, tone, is_active, variables)
    VALUES (v_company, v_branch, '미납 안내',
      $tpl$[#{지점명}] #{회원명}님, 회원권 결제가 아직 확인되지 않았습니다. 정상 출입을 위해 결제 부탁드립니다. 문의는 #{지점전화}로 연락 주세요.$tpl$,
      'sms', 'manual', 'unpaid_notice', 'all', 'billing', 'professional', true,
      $v${"is_ad": false, "mode": "auto", "vars": ["회원명","지점명","지점전화"]}$v$::jsonb);
  END IF;

  -- 2) 15일 미출석 복귀 (관계성 · 검토) — 기존 플레이북 step1 이 참조
  IF NOT EXISTS (SELECT 1 FROM public.message_templates
                 WHERE company_id = v_company AND segment_key = 'winback_boxing' AND deleted_at IS NULL) THEN
    INSERT INTO public.message_templates
      (company_id, branch_id, name, content, channel, trigger_type, segment_key, product_type, lifecycle_stage, tone, is_active, variables)
    VALUES (v_company, v_branch, '15일 미출석 복귀',
      $tpl$[#{지점명}] #{회원명}님, 한동안 뵙지 못해 안부 전합니다. 운동은 한 번 쉬면 다시 시작이 어려운데, 부담 갖지 마시고 가볍게 한 번 나와 주세요. 코치가 처음처럼 옆에서 함께 잡아드리겠습니다. 문의 #{지점전화}$tpl$,
      'sms', 'manual', 'winback_boxing', 'boxing', 'dormant', 'professional', true,
      $v${"is_ad": false, "mode": "review", "vars": ["회원명","지점명","지점전화"]}$v$::jsonb);
  END IF;

  -- 3) 복귀 출석 칭찬 (관계성 · 검토) — 기존 플레이북 step4 가 참조
  IF NOT EXISTS (SELECT 1 FROM public.message_templates
                 WHERE company_id = v_company AND segment_key = 'praise_return' AND deleted_at IS NULL) THEN
    INSERT INTO public.message_templates
      (company_id, branch_id, name, content, channel, trigger_type, segment_key, product_type, lifecycle_stage, tone, is_active, variables)
    VALUES (v_company, v_branch, '복귀 출석 칭찬',
      $tpl$[#{지점명}] #{회원명}님, 다시 나와 주셔서 정말 반가웠습니다. 다시 시작하는 그 한 걸음이 가장 중요합니다. 오늘처럼 꾸준히 이어가시도록 코치가 끝까지 함께하겠습니다.$tpl$,
      'sms', 'manual', 'praise_return', 'boxing', 'active', 'professional', true,
      $v${"is_ad": false, "mode": "review", "vars": ["회원명","지점명"]}$v$::jsonb);
  END IF;

  -- 4) 꾸준 출석 칭찬 (관계성 · 검토) — 기존 플레이북 step1 이 참조
  IF NOT EXISTS (SELECT 1 FROM public.message_templates
                 WHERE company_id = v_company AND segment_key = 'praise_consistent' AND deleted_at IS NULL) THEN
    INSERT INTO public.message_templates
      (company_id, branch_id, name, content, channel, trigger_type, segment_key, product_type, lifecycle_stage, tone, is_active, variables)
    VALUES (v_company, v_branch, '꾸준 출석 칭찬',
      $tpl$[#{지점명}] #{회원명}님, 꾸준히 나와 주시는 모습이 정말 보기 좋습니다. 그 성실함이 그대로 실력으로 쌓이고 있어요. 다음 단계 목표는 코치가 함께 잡아드리겠습니다. 오늘도 기다리겠습니다.$tpl$,
      'sms', 'manual', 'praise_consistent', 'all', 'active', 'professional', true,
      $v${"is_ad": false, "mode": "review", "vars": ["회원명","지점명"]}$v$::jsonb);
  END IF;

  -- 5) PT 다음 목표 상담 (관계성 · 검토) — 기존 플레이북 step2 가 참조
  IF NOT EXISTS (SELECT 1 FROM public.message_templates
                 WHERE company_id = v_company AND segment_key = 'pt_next_goal' AND deleted_at IS NULL) THEN
    INSERT INTO public.message_templates
      (company_id, branch_id, name, content, channel, trigger_type, segment_key, product_type, lifecycle_stage, tone, is_active, variables)
    VALUES (v_company, v_branch, 'PT 다음 목표 상담',
      $tpl$[#{지점명}] #{회원명}님, PT 회차가 얼마 남지 않았습니다. 지금까지의 변화를 이어가시려면 다음 목표를 함께 정하는 것이 좋아요. 담당 코치가 편하실 때 상담 도와드리겠습니다. 문의 #{지점전화}$tpl$,
      'sms', 'manual', 'pt_next_goal', 'pt', 'active', 'professional', true,
      $v${"is_ad": false, "mode": "review", "vars": ["회원명","지점명","지점전화"]}$v$::jsonb);
  END IF;

  RAISE NOTICE '메시징 1단계: message_templates 시드 완료 (company=%)', v_company;
END $$;

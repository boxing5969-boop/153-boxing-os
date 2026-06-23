-- ============================================================
-- 메시징 자동화 2단계 — 추가 상황 세그먼트 + 플레이북 + 문구
-- ============================================================
-- compute_member_snapshots(핵심 함수)는 건드리지 않는다.
-- 대신 새 함수 compute_extra_segments() 가 스냅샷 직후 "1회성" 세그먼트를 배정하고,
-- fc_daily_run() 이 compute → compute_extra → run_playbooks 순으로 호출하도록 1줄만 추가.
--
-- 추가 세그먼트(모두 '딱 하루만' 충족 → 매일 중복발송 없음):
--   welcome_new (가입 다음날) · absent_3d · absent_7d (정확히 3·7일 미출석)
--   birthday (생일 당일) · trial_ending (체험 종료 1일 전) · expired_d1 (만료 다음날)
-- run_playbooks 는 member_segments.source='auto' 만 보므로 source='auto' 로 넣는다.
-- 멱등 / 구조 변경 없음(함수 추가·치환 + 데이터).
-- ============================================================

-- ── 1) 새 함수: 1회성 추가 세그먼트 배정 ─────────────────────
CREATE OR REPLACE FUNCTION public.compute_extra_segments(p_branch_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_n int := 0;
BEGIN
  INSERT INTO public.member_segments (branch_id, member_id, segment_key, source)
  SELECT sn.branch_id, sn.member_id, x.seg, 'auto'
  FROM public.member_status_snapshots sn
  JOIN public.members m
    ON m.id = sn.member_id AND m.deleted_at IS NULL AND m.status <> 'withdrawn'
  CROSS JOIN LATERAL (VALUES
    ('welcome_new',  ((v_today - (m.created_at AT TIME ZONE 'Asia/Seoul')::date) = 1)),
    ('absent_3d',    (sn.days_since_last_visit = 3)),
    ('absent_7d',    (sn.days_since_last_visit = 7)),
    ('birthday',     (m.birth_date IS NOT NULL
                       AND to_char(m.birth_date,'MM-DD') = to_char(v_today,'MM-DD'))),
    ('trial_ending', EXISTS (SELECT 1 FROM public.trial_passes t
                              WHERE t.member_id = m.id AND t.status = 'active'
                                AND (t.end_at AT TIME ZONE 'Asia/Seoul')::date - v_today = 1)),
    ('expired_d1',   (sn.membership_expiry_date = v_today - 1))
  ) AS x(seg, cond)
  WHERE sn.snapshot_date = v_today
    AND (p_branch_id IS NULL OR sn.branch_id = p_branch_id)
    AND x.cond
  ON CONFLICT (member_id, segment_key) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'date', v_today, 'extra_segments_assigned', v_n);
END $fn$;

GRANT EXECUTE ON FUNCTION public.compute_extra_segments(uuid) TO service_role;

-- ── 2) fc_daily_run: compute → compute_extra → run_playbooks ──
CREATE OR REPLACE FUNCTION public.fc_daily_run()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_snap  jsonb;
  v_extra jsonb;
  v_pb    jsonb;
BEGIN
  v_snap  := public.compute_member_snapshots();
  v_extra := public.compute_extra_segments();   -- 2단계: 1회성 세그먼트 추가
  v_pb    := public.run_playbooks();
  RETURN jsonb_build_object(
    'success', true, 'ran_at', now(),
    'snapshots', v_snap, 'extra_segments', v_extra, 'playbooks', v_pb);
END $fn$;

-- ── 3) 플레이북 6종 + 문구 6종 ───────────────────────────────
DO $$
DECLARE
  v_company uuid := (SELECT id FROM public.companies ORDER BY created_at LIMIT 1);
  v_branch  uuid := (SELECT id FROM public.branches
                      WHERE name ILIKE '%강남%' AND deleted_at IS NULL ORDER BY created_at LIMIT 1);
  v_rule    uuid;
BEGIN
  IF v_company IS NULL THEN RAISE NOTICE 'company 없음 — 중단'; RETURN; END IF;

  -- 문구 시드 (정중한 존댓말 / [#{지점명}] 접두 / #{회원명} #{지점전화})
  -- welcome_new (정보성·자동)
  IF NOT EXISTS (SELECT 1 FROM public.message_templates WHERE company_id=v_company AND segment_key='welcome_new' AND deleted_at IS NULL) THEN
    INSERT INTO public.message_templates (company_id,branch_id,name,content,channel,trigger_type,segment_key,product_type,lifecycle_stage,tone,is_active,variables)
    VALUES (v_company,v_branch,'신규 환영',$tpl$[#{지점명}] #{회원명}님, 153복싱짐 가족이 되신 것을 진심으로 환영합니다. 편한 운동복만 챙겨 오시면 코치가 처음부터 끝까지 함께합니다. 궁금한 점은 언제든 #{지점전화}로 연락 주세요.$tpl$,'sms','manual','welcome_new','all','new_0_7_days','professional',true,$v${"is_ad":false,"mode":"auto","vars":["회원명","지점명","지점전화"]}$v$::jsonb);
  END IF;
  -- absent_3d (관계·검토)
  IF NOT EXISTS (SELECT 1 FROM public.message_templates WHERE company_id=v_company AND segment_key='absent_3d' AND deleted_at IS NULL) THEN
    INSERT INTO public.message_templates (company_id,branch_id,name,content,channel,trigger_type,segment_key,product_type,lifecycle_stage,tone,is_active,variables)
    VALUES (v_company,v_branch,'3일 미출석 안부',$tpl$[#{지점명}] #{회원명}님, 며칠 뵙지 못해 안부 전합니다. 컨디션은 괜찮으신가요? 가볍게 몸 풀러 오셔도 코치가 옆에서 함께 잡아드리겠습니다. 편하실 때 들러 주세요. 문의 #{지점전화}$tpl$,'sms','manual','absent_3d','all','attendance_risk','professional',true,$v${"is_ad":false,"mode":"review","vars":["회원명","지점명","지점전화"]}$v$::jsonb);
  END IF;
  -- absent_7d (관계·검토)
  IF NOT EXISTS (SELECT 1 FROM public.message_templates WHERE company_id=v_company AND segment_key='absent_7d' AND deleted_at IS NULL) THEN
    INSERT INTO public.message_templates (company_id,branch_id,name,content,channel,trigger_type,segment_key,product_type,lifecycle_stage,tone,is_active,variables)
    VALUES (v_company,v_branch,'7일 미출석 재방문',$tpl$[#{지점명}] #{회원명}님, 한 주 동안 뵙지 못했습니다. 운동 리듬은 한 번 쉬면 다시 잡기 어려운데, 이번 주 한 번만 나와 주세요. 코치가 가볍게 다시 시작하시도록 도와드리겠습니다. 문의 #{지점전화}$tpl$,'sms','manual','absent_7d','all','attendance_risk','professional',true,$v${"is_ad":false,"mode":"review","vars":["회원명","지점명","지점전화"]}$v$::jsonb);
  END IF;
  -- birthday (관계·검토)
  IF NOT EXISTS (SELECT 1 FROM public.message_templates WHERE company_id=v_company AND segment_key='birthday' AND deleted_at IS NULL) THEN
    INSERT INTO public.message_templates (company_id,branch_id,name,content,channel,trigger_type,segment_key,product_type,lifecycle_stage,tone,is_active,variables)
    VALUES (v_company,v_branch,'생일 축하',$tpl$[#{지점명}] #{회원명}님, 생신 진심으로 축하드립니다. 늘 건강하게 운동 이어가시길 응원하겠습니다. 오늘 오시면 코치들이 직접 축하 인사 드리겠습니다.$tpl$,'sms','manual','birthday','all','active','professional',true,$v${"is_ad":false,"mode":"review","vars":["회원명","지점명"]}$v$::jsonb);
  END IF;
  -- trial_ending (관계·검토)
  IF NOT EXISTS (SELECT 1 FROM public.message_templates WHERE company_id=v_company AND segment_key='trial_ending' AND deleted_at IS NULL) THEN
    INSERT INTO public.message_templates (company_id,branch_id,name,content,channel,trigger_type,segment_key,product_type,lifecycle_stage,tone,is_active,variables)
    VALUES (v_company,v_branch,'체험 종료 임박',$tpl$[#{지점명}] #{회원명}님, 체험 기간이 곧 끝납니다. 지금까지 익히신 동작을 정회원으로 이어가시면 코치가 처음 과정부터 끝까지 함께합니다. 등록 상담은 #{지점전화}로 편하게 문의 주세요.$tpl$,'sms','manual','trial_ending','trial','active','professional',true,$v${"is_ad":false,"mode":"review","vars":["회원명","지점명","지점전화"]}$v$::jsonb);
  END IF;
  -- expired_winback (관계·검토) — expired_d1 플레이북이 참조
  IF NOT EXISTS (SELECT 1 FROM public.message_templates WHERE company_id=v_company AND segment_key='expired_winback' AND deleted_at IS NULL) THEN
    INSERT INTO public.message_templates (company_id,branch_id,name,content,channel,trigger_type,segment_key,product_type,lifecycle_stage,tone,is_active,variables)
    VALUES (v_company,v_branch,'만료 후 재등록',$tpl$[#{지점명}] #{회원명}님, 그동안 잘 지내셨나요? 다시 시작하실 때 처음처럼 코치가 끝까지 함께하겠습니다. 가볍게 상담부터 원하시면 #{지점전화}로 연락 주세요.$tpl$,'sms','manual','expired_winback','all','expired','professional',true,$v${"is_ad":false,"mode":"review","vars":["회원명","지점명","지점전화"]}$v$::jsonb);
  END IF;

  -- 플레이북 6종 (trigger_segment → generate_message → 템플릿)
  IF NOT EXISTS (SELECT 1 FROM public.playbook_rules WHERE company_id=v_company AND name='신규 회원 환영') THEN
    INSERT INTO public.playbook_rules (company_id,name,description,trigger_segment,conditions,priority)
    VALUES (v_company,'신규 회원 환영','가입 직후 환영 안내(정보성·자동)','welcome_new','{}'::jsonb,'normal') RETURNING id INTO v_rule;
    INSERT INTO public.playbook_steps (playbook_rule_id,step_order,action_type,task_type,delay_days,condition,template_segment_key,description)
    VALUES (v_rule,1,'generate_message',NULL,0,'{}'::jsonb,'welcome_new','환영 메시지 생성');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.playbook_rules WHERE company_id=v_company AND name='3일 미출석 안부') THEN
    INSERT INTO public.playbook_rules (company_id,name,description,trigger_segment,conditions,priority)
    VALUES (v_company,'3일 미출석 안부','3일 미출석 회원 안부','absent_3d','{}'::jsonb,'normal') RETURNING id INTO v_rule;
    INSERT INTO public.playbook_steps (playbook_rule_id,step_order,action_type,task_type,delay_days,condition,template_segment_key,description)
    VALUES (v_rule,1,'generate_message',NULL,0,'{}'::jsonb,'absent_3d','3일 미출석 안부 메시지');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.playbook_rules WHERE company_id=v_company AND name='7일 미출석 재방문') THEN
    INSERT INTO public.playbook_rules (company_id,name,description,trigger_segment,conditions,priority)
    VALUES (v_company,'7일 미출석 재방문','7일 미출석 회원 재방문 유도','absent_7d','{}'::jsonb,'high') RETURNING id INTO v_rule;
    INSERT INTO public.playbook_steps (playbook_rule_id,step_order,action_type,task_type,delay_days,condition,template_segment_key,description)
    VALUES (v_rule,1,'generate_message',NULL,0,'{}'::jsonb,'absent_7d','7일 미출석 재방문 메시지');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.playbook_rules WHERE company_id=v_company AND name='생일 축하') THEN
    INSERT INTO public.playbook_rules (company_id,name,description,trigger_segment,conditions,priority)
    VALUES (v_company,'생일 축하','생일 당일 축하','birthday','{}'::jsonb,'normal') RETURNING id INTO v_rule;
    INSERT INTO public.playbook_steps (playbook_rule_id,step_order,action_type,task_type,delay_days,condition,template_segment_key,description)
    VALUES (v_rule,1,'generate_message',NULL,0,'{}'::jsonb,'birthday','생일 축하 메시지');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.playbook_rules WHERE company_id=v_company AND name='체험 종료 임박 전환') THEN
    INSERT INTO public.playbook_rules (company_id,name,description,trigger_segment,conditions,priority)
    VALUES (v_company,'체험 종료 임박 전환','체험 종료 1일 전 정회원 전환 유도','trial_ending','{}'::jsonb,'high') RETURNING id INTO v_rule;
    INSERT INTO public.playbook_steps (playbook_rule_id,step_order,action_type,task_type,delay_days,condition,template_segment_key,description)
    VALUES (v_rule,1,'generate_message',NULL,0,'{}'::jsonb,'trial_ending','체험 전환 상담 메시지');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.playbook_rules WHERE company_id=v_company AND name='만료 후 재등록') THEN
    INSERT INTO public.playbook_rules (company_id,name,description,trigger_segment,conditions,priority)
    VALUES (v_company,'만료 후 재등록','만료 다음날 재등록 유도','expired_d1','{}'::jsonb,'high') RETURNING id INTO v_rule;
    INSERT INTO public.playbook_steps (playbook_rule_id,step_order,action_type,task_type,delay_days,condition,template_segment_key,description)
    VALUES (v_rule,1,'generate_message',NULL,0,'{}'::jsonb,'expired_winback','재등록 유도 메시지');
  END IF;

  RAISE NOTICE '메시징 2단계: 함수+플레이북6+문구6 완료 (company=%)', v_company;
END $$;

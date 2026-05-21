-- ============================================================
-- Fix: process_survey_response 의 ON CONFLICT 절 수정
-- ============================================================
-- tasks.idempotency_key 는 부분(partial) 유니크 인덱스
--   (uq_tasks_idem ... WHERE idempotency_key IS NOT NULL)
-- 이므로 ON CONFLICT 추론 시 동일한 WHERE 절을 명시해야 한다.
-- 누락 시: "there is no unique or exclusion constraint matching
--          the ON CONFLICT specification" 오류로 자동처리 전체가 롤백됨.
-- ============================================================

CREATE OR REPLACE FUNCTION public.process_survey_response(p_response_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_resp     public.survey_responses%ROWTYPE;
  v_overall  numeric;
  v_renewal  numeric;
  v_mgr      uuid;
  v_keywords text[] := ARRAY['불만','환불','최악','더럽','불친절','짜증','실망','항의','별로','화나'];
  v_kw       text;
  v_found_kw text;
  v_txt      text;
  v_ans      numeric;
  r_q        record;
BEGIN
  SELECT * INTO v_resp FROM public.survey_responses WHERE id = p_response_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'RESPONSE_NOT_FOUND');
  END IF;

  IF EXISTS (SELECT 1 FROM public.survey_response_scores WHERE response_id = p_response_id) THEN
    RETURN jsonb_build_object('success', true, 'skipped', 'already_processed');
  END IF;

  SELECT round(avg(a.answer_score)::numeric, 2) INTO v_overall
  FROM public.survey_answers a
  JOIN public.survey_questions q ON q.id = a.question_id
  WHERE a.response_id = p_response_id
    AND a.answer_score IS NOT NULL
    AND COALESCE((q.options->>'max')::int, 5) <= 5;

  IF v_overall IS NOT NULL THEN
    INSERT INTO public.survey_response_scores
      (response_id, survey_template_id, branch_id, metric, score)
    VALUES (p_response_id, v_resp.survey_template_id, v_resp.branch_id, 'overall', v_overall)
    ON CONFLICT (response_id, metric) DO NOTHING;
  END IF;

  FOR r_q IN
    SELECT q.metric_key AS mk, a.answer_score, a.answer_text
    FROM public.survey_questions q
    JOIN public.survey_answers a ON a.question_id = q.id AND a.response_id = p_response_id
    WHERE q.metric_key IS NOT NULL
  LOOP
    v_ans := COALESCE(
      r_q.answer_score,
      CASE WHEN r_q.answer_text ~ '^[0-9.]+$' THEN r_q.answer_text::numeric END
    );
    IF v_ans IS NOT NULL THEN
      INSERT INTO public.survey_response_scores
        (response_id, survey_template_id, branch_id, metric, score)
      VALUES (p_response_id, v_resp.survey_template_id, v_resp.branch_id, r_q.mk, v_ans)
      ON CONFLICT (response_id, metric) DO NOTHING;
      IF r_q.mk = 'renewal_intent' THEN v_renewal := v_ans; END IF;
    END IF;
  END LOOP;

  SELECT id INTO v_mgr FROM public.profiles
  WHERE branch_id = v_resp.branch_id
    AND role IN ('branch_owner','branch_manager')
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_overall >= 4.8 THEN
    PERFORM public.enqueue_message_job(
      v_resp.branch_id, 'kakao', 'review_request', v_resp.member_id,
      jsonb_build_object('overall', v_overall, 'response_id', p_response_id),
      now(), v_resp.respondent_phone, 'review:' || p_response_id);
  END IF;

  IF v_overall <= 3.0 THEN
    INSERT INTO public.tasks
      (branch_id, member_id, assigned_to, task_type, title, description,
       priority, source_table, source_id, idempotency_key)
    VALUES
      (v_resp.branch_id, v_resp.member_id, v_mgr, 'low_satisfaction',
       '만족도 낮은 설문 응답 확인',
       '설문 만족도 ' || v_overall || '점. 회원 응대가 필요합니다.',
       'urgent', 'survey_responses', p_response_id, 'survey_low:' || p_response_id)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

    INSERT INTO public.survey_alerts
      (branch_id, survey_template_id, response_id, member_id,
       alert_type, severity, message, assigned_to)
    VALUES
      (v_resp.branch_id, v_resp.survey_template_id, p_response_id, v_resp.member_id,
       'low_score', 'urgent',
       '만족도 ' || v_overall || '점 응답이 접수되었습니다.', v_mgr);
  END IF;

  IF v_renewal IS NOT NULL AND v_renewal <= 2 THEN
    INSERT INTO public.tasks
      (branch_id, member_id, assigned_to, task_type, title, description,
       priority, source_table, source_id, idempotency_key)
    VALUES
      (v_resp.branch_id, v_resp.member_id, v_mgr, 'follow_up',
       '재등록 의향 낮은 회원 상담',
       '설문상 재등록 의향이 낮습니다. 상담을 권장합니다.',
       'high', 'survey_responses', p_response_id, 'survey_renewal:' || p_response_id)
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

    INSERT INTO public.survey_alerts
      (branch_id, survey_template_id, response_id, member_id,
       alert_type, severity, message, assigned_to)
    VALUES
      (v_resp.branch_id, v_resp.survey_template_id, p_response_id, v_resp.member_id,
       'low_renewal_intent', 'warning',
       '재등록 의향 점수 ' || v_renewal || '점.', v_mgr);
  END IF;

  FOR v_txt IN
    SELECT a.answer_text FROM public.survey_answers a
    WHERE a.response_id = p_response_id AND a.answer_text IS NOT NULL
  LOOP
    EXIT WHEN v_found_kw IS NOT NULL;
    FOREACH v_kw IN ARRAY v_keywords LOOP
      IF v_txt LIKE '%' || v_kw || '%' THEN
        v_found_kw := v_kw;
        EXIT;
      END IF;
    END LOOP;
  END LOOP;

  IF v_found_kw IS NOT NULL THEN
    INSERT INTO public.survey_alerts
      (branch_id, survey_template_id, response_id, member_id,
       alert_type, severity, keyword, message, assigned_to)
    VALUES
      (v_resp.branch_id, v_resp.survey_template_id, p_response_id, v_resp.member_id,
       'complaint_keyword', 'warning', v_found_kw,
       '불만 키워드 "' || v_found_kw || '" 감지됨', v_mgr);
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'response_id', p_response_id,
    'overall', v_overall, 'renewal_intent', v_renewal,
    'complaint_keyword', v_found_kw);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;

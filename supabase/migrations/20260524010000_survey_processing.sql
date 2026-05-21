-- ============================================================
-- 3차: 설문 응답 자동처리 (점수계산 + 만족도 규칙)
-- ============================================================
-- process_survey_response(response_id) : 응답 점수 계산 + 자동 규칙 실행
--   - overall 만족도 = 5점척도 rating 답변 평균
--   - 4.8 이상 → 후기요청 message_job
--   - 3.0 이하 → branch_manager urgent task + survey_alert
--   - 재등록 의향(renewal_intent) 낮음 → follow_up task
--   - 불만 키워드 → survey_alert
-- survey_responses 에 지연(deferred) 제약 트리거를 걸어, 응답+답변이
-- 모두 저장된 트랜잭션 커밋 시점에 자동 실행 → 기존 제출 RPC 무수정.
-- 자동처리 실패는 삼켜서 설문 제출 자체는 항상 성공하도록 함.
-- ============================================================

-- ── 익명/개인정보 응답 자동 구분 ────────────────────────────
CREATE OR REPLACE FUNCTION public.set_response_anonymity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- 회원ID·연락처가 모두 없으면 익명 응답
  NEW.is_anonymous := (NEW.member_id IS NULL AND NEW.respondent_phone IS NULL);
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_survey_responses_anonymity
  BEFORE INSERT ON public.survey_responses
  FOR EACH ROW EXECUTE FUNCTION public.set_response_anonymity();

-- ── 자동처리 본체 ───────────────────────────────────────────
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

  -- 이미 처리된 응답이면 재처리 안 함
  IF EXISTS (SELECT 1 FROM public.survey_response_scores WHERE response_id = p_response_id) THEN
    RETURN jsonb_build_object('success', true, 'skipped', 'already_processed');
  END IF;

  -- 1. overall = 5점 척도 rating 답변 평균
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

  -- 2. metric_key 태깅 질문별 점수
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

  -- 지점 관리자(task/alert 배정 대상)
  SELECT id INTO v_mgr FROM public.profiles
  WHERE branch_id = v_resp.branch_id
    AND role IN ('branch_owner','branch_manager')
    AND deleted_at IS NULL
  LIMIT 1;

  -- 3a. 만족도 4.8 이상 → 후기 요청 메시지 큐
  IF v_overall >= 4.8 THEN
    PERFORM public.enqueue_message_job(
      v_resp.branch_id, 'kakao', 'review_request', v_resp.member_id,
      jsonb_build_object('overall', v_overall, 'response_id', p_response_id),
      now(), v_resp.respondent_phone, 'review:' || p_response_id);
  END IF;

  -- 3b. 만족도 3.0 이하 → urgent task + survey_alert
  IF v_overall <= 3.0 THEN
    INSERT INTO public.tasks
      (branch_id, member_id, assigned_to, task_type, title, description,
       priority, source_table, source_id, idempotency_key)
    VALUES
      (v_resp.branch_id, v_resp.member_id, v_mgr, 'low_satisfaction',
       '만족도 낮은 설문 응답 확인',
       '설문 만족도 ' || v_overall || '점. 회원 응대가 필요합니다.',
       'urgent', 'survey_responses', p_response_id, 'survey_low:' || p_response_id)
    ON CONFLICT (idempotency_key) DO NOTHING;

    INSERT INTO public.survey_alerts
      (branch_id, survey_template_id, response_id, member_id,
       alert_type, severity, message, assigned_to)
    VALUES
      (v_resp.branch_id, v_resp.survey_template_id, p_response_id, v_resp.member_id,
       'low_score', 'urgent',
       '만족도 ' || v_overall || '점 응답이 접수되었습니다.', v_mgr);
  END IF;

  -- 3c. 재등록 의향 낮음(<=2) → follow_up task
  IF v_renewal IS NOT NULL AND v_renewal <= 2 THEN
    INSERT INTO public.tasks
      (branch_id, member_id, assigned_to, task_type, title, description,
       priority, source_table, source_id, idempotency_key)
    VALUES
      (v_resp.branch_id, v_resp.member_id, v_mgr, 'follow_up',
       '재등록 의향 낮은 회원 상담',
       '설문상 재등록 의향이 낮습니다. 상담을 권장합니다.',
       'high', 'survey_responses', p_response_id, 'survey_renewal:' || p_response_id)
    ON CONFLICT (idempotency_key) DO NOTHING;

    INSERT INTO public.survey_alerts
      (branch_id, survey_template_id, response_id, member_id,
       alert_type, severity, message, assigned_to)
    VALUES
      (v_resp.branch_id, v_resp.survey_template_id, p_response_id, v_resp.member_id,
       'low_renewal_intent', 'warning',
       '재등록 의향 점수 ' || v_renewal || '점.', v_mgr);
  END IF;

  -- 3d. 불만 키워드 → survey_alert (응답당 1건)
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

GRANT EXECUTE ON FUNCTION public.process_survey_response(uuid) TO authenticated, service_role;

-- ── 지연 제약 트리거: 제출 트랜잭션 커밋 시 자동 실행 ───────
CREATE OR REPLACE FUNCTION public.process_survey_response_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- 자동처리 실패가 설문 제출을 막지 않도록 항상 성공 반환
  PERFORM public.process_survey_response(NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'process_survey_response 트리거 실패 (response %): %', NEW.id, SQLERRM;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_survey_response_process ON public.survey_responses;
CREATE CONSTRAINT TRIGGER trg_survey_response_process
  AFTER INSERT ON public.survey_responses
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.process_survey_response_trg();

DO $$ BEGIN
  RAISE NOTICE '설문 응답 자동처리(점수+만족도 규칙) 완료';
END $$;

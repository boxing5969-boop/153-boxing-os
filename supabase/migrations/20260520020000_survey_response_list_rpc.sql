-- ============================================================
-- Survey Phase 4: 설문 개별 응답 목록 조회 RPC
-- 목적 : 결과 화면에서 응답 목록 + 답변 + 후속관리 상태를 일괄 반환
--        - survey_responses × survey_answers × survey_questions × survey_followups JOIN
--        - 지점 권한 검증 포함 (SECURITY DEFINER)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_survey_response_list(
  p_survey_template_id UUID,
  p_limit              INT  DEFAULT 200
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template      public.survey_templates%ROWTYPE;
  v_caller_role   TEXT;
  v_caller_branch UUID;
  v_result        JSONB;
BEGIN
  -- 1. 템플릿 조회
  SELECT * INTO v_template
  FROM public.survey_templates
  WHERE id = p_survey_template_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'TEMPLATE_NOT_FOUND');
  END IF;

  -- 2. 권한 확인
  SELECT p.role, p.branch_id
  INTO v_caller_role, v_caller_branch
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid();

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  IF v_caller_role NOT IN ('super_admin', 'hq_admin') THEN
    IF v_caller_branch IS DISTINCT FROM v_template.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
    END IF;
  END IF;

  -- 3. 응답 목록 (최신순, 최대 p_limit 건)
  SELECT jsonb_build_object(
    'success', true,
    'total', (
      SELECT COUNT(*)
      FROM public.survey_responses r
      WHERE r.survey_template_id = p_survey_template_id
    ),
    'responses', (
      SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'submitted_at' DESC), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'id',               r.id,
          'submitted_at',     r.submitted_at,
          'respondent_phone', r.respondent_phone,
          -- 답변 목록 (질문 정보 포함)
          'answers', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'question_id',   a.question_id,
                'question_text', q.question_text,
                'question_type', q.question_type,
                'order_index',   q.order_index,
                'options',       q.options,
                'answer_text',   a.answer_text,
                'answer_score',  a.answer_score
              )
              ORDER BY q.order_index
            ), '[]'::jsonb)
            FROM public.survey_answers a
            JOIN public.survey_questions q ON q.id = a.question_id
            WHERE a.response_id = r.id
          ),
          -- 후속관리 (없으면 null)
          'followup', (
            SELECT jsonb_build_object(
              'id',          f.id,
              'status',      f.status,
              'notes',       f.notes,
              'assigned_to', f.assigned_to,
              'resolved_at', f.resolved_at,
              'created_at',  f.created_at,
              'updated_at',  f.updated_at
            )
            FROM public.survey_followups f
            WHERE f.response_id = r.id
            LIMIT 1
          )
        ) AS row_data
        FROM public.survey_responses r
        WHERE r.survey_template_id = p_survey_template_id
        ORDER BY r.submitted_at DESC
        LIMIT p_limit
      ) sub
    )
  ) INTO v_result;

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_survey_response_list(UUID, INT) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE 'get_survey_response_list RPC created';
END;
$$;

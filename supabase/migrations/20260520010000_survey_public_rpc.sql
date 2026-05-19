-- ============================================================
-- Survey Phase 3: 공개 설문 조회 RPC
-- 목적 : QR slug로 설문 정보를 anon에게 안전하게 반환한다.
--        직접 테이블 SELECT 권한을 anon에 주지 않고 SECURITY DEFINER로 우회.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_public_survey(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qr       public.survey_qr_codes%ROWTYPE;
  v_template public.survey_templates%ROWTYPE;
  v_branch   record;
  v_result   JSONB;
BEGIN
  -- 1. QR 코드 조회
  SELECT * INTO v_qr
  FROM public.survey_qr_codes
  WHERE slug = p_slug;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR_NOT_FOUND');
  END IF;

  -- 2. QR 상태 확인
  IF v_qr.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR_INACTIVE');
  END IF;

  -- 3. 유효기간 확인
  IF v_qr.valid_until IS NOT NULL AND NOW() > v_qr.valid_until THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR_EXPIRED');
  END IF;
  IF NOW() < v_qr.valid_from THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR_NOT_YET_VALID');
  END IF;

  -- 4. 설문 템플릿 조회
  SELECT * INTO v_template
  FROM public.survey_templates
  WHERE id = v_qr.survey_template_id;

  IF NOT FOUND OR v_template.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SURVEY_INACTIVE');
  END IF;

  -- 5. 지점명 조회 (개인정보 최소화 — 지점명만 반환)
  SELECT name INTO v_branch
  FROM public.branches
  WHERE id = v_qr.branch_id;

  -- 6. 질문 목록 조회 (활성 설문의 질문만)
  SELECT jsonb_build_object(
    'success',     true,
    'qr_code_id',  v_qr.id,
    'branch_name', COALESCE(v_branch.name, '153 Boxing'),
    'template', jsonb_build_object(
      'id',          v_template.id,
      'title',       v_template.title,
      'description', v_template.description
    ),
    'questions', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',            q.id,
          'order_index',   q.order_index,
          'question_type', q.question_type,
          'question_text', q.question_text,
          'options',       q.options,
          'is_required',   q.is_required
        )
        ORDER BY q.order_index
      )
      FROM public.survey_questions q
      WHERE q.survey_template_id = v_template.id
    )
  ) INTO v_result;

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- anon(비로그인) + authenticated 모두 호출 가능
GRANT EXECUTE ON FUNCTION public.get_public_survey(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_survey(TEXT) TO authenticated;

DO $$
BEGIN
  RAISE NOTICE 'get_public_survey RPC created';
END;
$$;

-- ============================================================
-- Survey QR Phase 1: 회원만족 설문 + QR 기반 스키마
-- ============================================================
-- 테이블 목록:
--   survey_templates   — 설문 템플릿
--   survey_questions   — 질문 항목
--   survey_qr_codes    — QR 발급 (slug 기반 공개 URL)
--   survey_responses   — 응답 헤더
--   survey_answers     — 질문별 답변
--   survey_followups   — 후속 조치 (불만/저점수 등)
-- RPC:
--   submit_survey_response  — 공개 응답 제출 (SECURITY DEFINER)
--   get_survey_results_summary — 집계 결과 조회 (SECURITY DEFINER)
-- ============================================================

-- ── 1. 설문 템플릿 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_templates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   UUID        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  description TEXT,
  -- 질문 스냅샷(선택): survey_questions 와 별도로 JSON으로도 보관 가능
  status      TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'inactive', 'archived')),
  created_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. 설문 질문 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_questions (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_template_id  UUID    NOT NULL REFERENCES public.survey_templates(id) ON DELETE CASCADE,
  order_index         INT     NOT NULL DEFAULT 0,
  question_type       TEXT    NOT NULL
                              CHECK (question_type IN ('rating', 'multiple_choice', 'text', 'yes_no')),
  question_text       TEXT    NOT NULL,
  -- rating: {min,max,labels}  multiple_choice: [{value,label}]  그 외: null
  options             JSONB,
  is_required         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. QR 발급 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_qr_codes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id           UUID        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  survey_template_id  UUID        NOT NULL REFERENCES public.survey_templates(id) ON DELETE CASCADE,
  -- 공개 URL 식별자 예: /survey/{slug}
  slug                TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(9), 'base64url'),
  -- HMAC 서명용 랜덤 시크릿 (Workers에서만 사용)
  token               TEXT        NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  label               TEXT,       -- 예: "1층 탈의실 앞", "프론트 데스크"
  valid_from          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until         TIMESTAMPTZ,  -- NULL = 만료 없음
  status              TEXT        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'inactive')),
  created_by          UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. 응답 헤더 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_responses (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_code_id        UUID        NOT NULL REFERENCES public.survey_qr_codes(id) ON DELETE CASCADE,
  branch_id         UUID        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  survey_template_id UUID       NOT NULL REFERENCES public.survey_templates(id) ON DELETE CASCADE,
  -- 비회원도 응답 가능 (member_id nullable)
  member_id         UUID        REFERENCES public.members(id) ON DELETE SET NULL,
  respondent_phone  TEXT,       -- 비회원 응답자 연락처 (선택)
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. 질문별 답변 ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_answers (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id  UUID    NOT NULL REFERENCES public.survey_responses(id) ON DELETE CASCADE,
  question_id  UUID    NOT NULL REFERENCES public.survey_questions(id) ON DELETE CASCADE,
  answer_text  TEXT,   -- text / multiple_choice / yes_no 응답
  answer_score INT,    -- rating 응답 (숫자)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. 후속 조치 (불만/저점수 응답 관리) ────────────────────
CREATE TABLE IF NOT EXISTS public.survey_followups (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id  UUID        NOT NULL UNIQUE REFERENCES public.survey_responses(id) ON DELETE CASCADE,
  branch_id    UUID        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'in_progress', 'resolved', 'dismissed')),
  notes        TEXT,
  assigned_to  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 인덱스 ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_survey_templates_branch
  ON public.survey_templates(branch_id, status);

CREATE INDEX IF NOT EXISTS idx_survey_questions_template
  ON public.survey_questions(survey_template_id, order_index);

CREATE INDEX IF NOT EXISTS idx_survey_qr_codes_branch
  ON public.survey_qr_codes(branch_id, status);

CREATE INDEX IF NOT EXISTS idx_survey_qr_codes_slug
  ON public.survey_qr_codes(slug);

CREATE INDEX IF NOT EXISTS idx_survey_responses_branch
  ON public.survey_responses(branch_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_survey_responses_qr
  ON public.survey_responses(qr_code_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_survey_answers_response
  ON public.survey_answers(response_id);

CREATE INDEX IF NOT EXISTS idx_survey_followups_branch
  ON public.survey_followups(branch_id, status);

-- ── updated_at 자동 갱신 트리거 ──────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_survey_templates_updated_at
  BEFORE UPDATE ON public.survey_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER trg_survey_followups_updated_at
  BEFORE UPDATE ON public.survey_followups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS 활성화 ───────────────────────────────────────────────
ALTER TABLE public.survey_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_qr_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_answers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_followups  ENABLE ROW LEVEL SECURITY;

-- ── GRANT ────────────────────────────────────────────────────
GRANT ALL ON public.survey_templates  TO service_role;
GRANT ALL ON public.survey_questions  TO service_role;
GRANT ALL ON public.survey_qr_codes   TO service_role;
GRANT ALL ON public.survey_responses  TO service_role;
GRANT ALL ON public.survey_answers    TO service_role;
GRANT ALL ON public.survey_followups  TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_templates  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_questions  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_qr_codes   TO authenticated;
GRANT SELECT                         ON public.survey_responses  TO authenticated;
GRANT SELECT                         ON public.survey_answers    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.survey_followups  TO authenticated;

-- anon: submit_survey_response RPC만 허용 (직접 테이블 접근 불가)
GRANT USAGE ON SCHEMA public TO anon;

-- ── RLS 정책 — survey_templates ─────────────────────────────
CREATE POLICY survey_templates_hq_all ON public.survey_templates
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());

CREATE POLICY survey_templates_branch_all ON public.survey_templates
  FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());

-- ── RLS 정책 — survey_questions ─────────────────────────────
-- branch_id 없음 → 템플릿을 통해 지점 제한
CREATE POLICY survey_questions_hq_all ON public.survey_questions
  FOR ALL TO authenticated
  USING (
    is_hq_admin()
  ) WITH CHECK (
    is_hq_admin()
  );

CREATE POLICY survey_questions_branch_all ON public.survey_questions
  FOR ALL TO authenticated
  USING (
    is_branch_admin() AND EXISTS (
      SELECT 1 FROM public.survey_templates t
      WHERE t.id = survey_questions.survey_template_id
        AND t.branch_id = current_branch_id()
    )
  )
  WITH CHECK (
    is_branch_admin() AND EXISTS (
      SELECT 1 FROM public.survey_templates t
      WHERE t.id = survey_questions.survey_template_id
        AND t.branch_id = current_branch_id()
    )
  );

-- ── RLS 정책 — survey_qr_codes ──────────────────────────────
CREATE POLICY survey_qr_hq_all ON public.survey_qr_codes
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());

CREATE POLICY survey_qr_branch_all ON public.survey_qr_codes
  FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());

-- ── RLS 정책 — survey_responses (SELECT 전용 — INSERT는 RPC) ──
CREATE POLICY survey_responses_hq_select ON public.survey_responses
  FOR SELECT TO authenticated
  USING (is_hq_admin());

CREATE POLICY survey_responses_branch_select ON public.survey_responses
  FOR SELECT TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id());

-- ── RLS 정책 — survey_answers (SELECT 전용 — INSERT는 RPC) ────
CREATE POLICY survey_answers_hq_select ON public.survey_answers
  FOR SELECT TO authenticated
  USING (
    is_hq_admin()
  );

CREATE POLICY survey_answers_branch_select ON public.survey_answers
  FOR SELECT TO authenticated
  USING (
    is_branch_admin() AND EXISTS (
      SELECT 1 FROM public.survey_responses r
      WHERE r.id = survey_answers.response_id
        AND r.branch_id = current_branch_id()
    )
  );

-- ── RLS 정책 — survey_followups ─────────────────────────────
CREATE POLICY survey_followups_hq_all ON public.survey_followups
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());

CREATE POLICY survey_followups_branch_all ON public.survey_followups
  FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());

-- ============================================================
-- RPC 1: submit_survey_response
-- 목적 : QR slug로 설문 응답을 공개 제출한다.
-- 보안 : SECURITY DEFINER + anon 실행 허용
--        → 직접 테이블 INSERT 권한은 anon에게 부여하지 않음.
-- 검증 : QR 상태(active), 유효기간, 템플릿 상태
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_survey_response(
  p_qr_slug          TEXT,
  p_answers          JSONB,   -- [{question_id, answer_text?, answer_score?}]
  p_member_id        UUID    DEFAULT NULL,
  p_respondent_phone TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qr         public.survey_qr_codes%ROWTYPE;
  v_template   public.survey_templates%ROWTYPE;
  v_response_id UUID;
  v_answer     JSONB;
  v_question   public.survey_questions%ROWTYPE;
BEGIN
  -- 1. QR 코드 조회
  SELECT * INTO v_qr
  FROM public.survey_qr_codes
  WHERE slug = p_qr_slug;

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

  -- 4. 템플릿 확인
  SELECT * INTO v_template
  FROM public.survey_templates
  WHERE id = v_qr.survey_template_id;

  IF NOT FOUND OR v_template.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SURVEY_INACTIVE');
  END IF;

  -- 5. 응답 헤더 삽입
  INSERT INTO public.survey_responses (
    qr_code_id, branch_id, survey_template_id,
    member_id, respondent_phone
  ) VALUES (
    v_qr.id, v_qr.branch_id, v_qr.survey_template_id,
    p_member_id, p_respondent_phone
  )
  RETURNING id INTO v_response_id;

  -- 6. 답변 삽입
  FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    -- 질문 존재 여부 확인
    SELECT * INTO v_question
    FROM public.survey_questions
    WHERE id = (v_answer->>'question_id')::UUID
      AND survey_template_id = v_qr.survey_template_id;

    IF FOUND THEN
      INSERT INTO public.survey_answers (
        response_id, question_id, answer_text, answer_score
      ) VALUES (
        v_response_id,
        (v_answer->>'question_id')::UUID,
        v_answer->>'answer_text',
        (v_answer->>'answer_score')::INT
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'response_id', v_response_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- anon (비로그인 응답자) 도 호출 가능
GRANT EXECUTE ON FUNCTION public.submit_survey_response(TEXT, JSONB, UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_survey_response(TEXT, JSONB, UUID, TEXT) TO authenticated;

-- ============================================================
-- RPC 2: get_survey_results_summary
-- 목적 : 설문 템플릿별 질문 집계 결과 반환
-- 보안 : SECURITY DEFINER + authenticated 전용
--        호출자가 해당 지점 관리자거나 HQ인지 검증
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_survey_results_summary(
  p_survey_template_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template    public.survey_templates%ROWTYPE;
  v_caller_role TEXT;
  v_caller_branch UUID;
  v_result      JSONB;
BEGIN
  -- 1. 템플릿 조회
  SELECT * INTO v_template
  FROM public.survey_templates
  WHERE id = p_survey_template_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'TEMPLATE_NOT_FOUND');
  END IF;

  -- 2. 권한 확인 (HQ 또는 해당 지점 관리자)
  SELECT p.role, p.branch_id
  INTO v_caller_role, v_caller_branch
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid();

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;

  IF v_caller_role NOT IN ('super_admin', 'hq_admin') THEN
    -- 지점 관리자면 자기 지점 템플릿만 조회 가능
    IF v_caller_branch IS DISTINCT FROM v_template.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
    END IF;
  END IF;

  -- 3. 집계 쿼리
  SELECT jsonb_build_object(
    'success', true,
    'template_id', p_survey_template_id,
    'total_responses', (
      SELECT COUNT(*)
      FROM public.survey_responses
      WHERE survey_template_id = p_survey_template_id
    ),
    'questions', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'question_id',   q.id,
          'order_index',   q.order_index,
          'question_type', q.question_type,
          'question_text', q.question_text,
          -- rating 평균
          'avg_score', (
            CASE WHEN q.question_type = 'rating' THEN (
              SELECT ROUND(AVG(a.answer_score)::NUMERIC, 2)
              FROM public.survey_answers a
              JOIN public.survey_responses r ON r.id = a.response_id
              WHERE a.question_id = q.id
                AND r.survey_template_id = p_survey_template_id
            ) ELSE NULL END
          ),
          -- 답변 분포 (multiple_choice, yes_no, text)
          'answer_distribution', (
            SELECT jsonb_agg(
              jsonb_build_object('value', ad.answer_text, 'count', ad.cnt)
              ORDER BY ad.cnt DESC
            )
            FROM (
              SELECT a.answer_text, COUNT(*) AS cnt
              FROM public.survey_answers a
              JOIN public.survey_responses r ON r.id = a.response_id
              WHERE a.question_id = q.id
                AND r.survey_template_id = p_survey_template_id
                AND a.answer_text IS NOT NULL
              GROUP BY a.answer_text
            ) ad
          ),
          -- rating 분포 (점수별 카운트)
          'score_distribution', (
            CASE WHEN q.question_type = 'rating' THEN (
              SELECT jsonb_agg(
                jsonb_build_object('score', sd.answer_score, 'count', sd.cnt)
                ORDER BY sd.answer_score
              )
              FROM (
                SELECT a.answer_score, COUNT(*) AS cnt
                FROM public.survey_answers a
                JOIN public.survey_responses r ON r.id = a.response_id
                WHERE a.question_id = q.id
                  AND r.survey_template_id = p_survey_template_id
                  AND a.answer_score IS NOT NULL
                GROUP BY a.answer_score
              ) sd
            ) ELSE NULL END
          )
        )
      )
      FROM public.survey_questions q
      WHERE q.survey_template_id = p_survey_template_id
      ORDER BY q.order_index
    )
  ) INTO v_result;

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_survey_results_summary(UUID) TO authenticated;

-- ============================================================
-- 완료 확인
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE 'survey_qr_foundation migration complete: 6 tables, 2 RPCs';
END;
$$;

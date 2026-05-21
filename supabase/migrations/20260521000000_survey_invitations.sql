-- ============================================================
-- Phase 5.5: 설문 발송(초대) 시스템 — survey_invitations
-- ============================================================
-- 목적 : 회원에게 SMS/카카오로 "개인 설문 링크"를 발송하고,
--        발송 → 열람 → 응답 단계를 회원별로 추적한다.
--
-- 추가 항목 (모두 추가형 — 기존 테이블 구조 변경 없음):
--   TABLE  survey_invitations          — 회원별 설문 초대/추적
--   COLUMN branches.kakao_tpl_survey   — 알림톡 설문 템플릿 코드
--   RPC    get_survey_invite           — 토큰으로 설문 열람 (anon)
--   RPC    submit_survey_via_invite    — 회원 귀속 응답 제출 (anon)
--   RPC    get_survey_invite_stats     — 설문별 발송/응답 통계 (authenticated)
-- ============================================================

-- ── 0. branches: 알림톡 설문 템플릿 코드 컬럼 ────────────────
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS kakao_tpl_survey TEXT;

COMMENT ON COLUMN public.branches.kakao_tpl_survey IS
  '알리고 알림톡 설문 안내용 템플릿 코드 (카카오 사전 승인 필요)';

-- ── 1. survey_invitations 테이블 ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_invitations (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_template_id UUID        NOT NULL REFERENCES public.survey_templates(id) ON DELETE CASCADE,
  qr_code_id         UUID        NOT NULL REFERENCES public.survey_qr_codes(id)  ON DELETE CASCADE,
  branch_id          UUID        NOT NULL REFERENCES public.branches(id)         ON DELETE CASCADE,
  member_id          UUID        NOT NULL REFERENCES public.members(id)          ON DELETE CASCADE,
  -- 발송 채널
  channel            TEXT        NOT NULL DEFAULT 'sms'
                                 CHECK (channel IN ('sms','kakao','both','kakao_sms_fallback','app_push','email','manual')),
  -- 회원별 고유 링크 토큰 (/s/{slug}?t={token})
  token              TEXT        NOT NULL UNIQUE
                                 DEFAULT encode(gen_random_bytes(16), 'base64url'),
  -- 추적 상태
  status             TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','sent','opened','responded','failed')),
  sent_at            TIMESTAMPTZ,
  opened_at          TIMESTAMPTZ,
  responded_at       TIMESTAMPTZ,
  response_id        UUID        REFERENCES public.survey_responses(id) ON DELETE SET NULL,
  error_message      TEXT,
  recipient_phone    TEXT,       -- 발송 시점 회원 연락처 스냅샷
  created_by         UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. 인덱스 ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_survey_invitations_template
  ON public.survey_invitations(survey_template_id, status);

CREATE INDEX IF NOT EXISTS idx_survey_invitations_token
  ON public.survey_invitations(token);

CREATE INDEX IF NOT EXISTS idx_survey_invitations_branch
  ON public.survey_invitations(branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_survey_invitations_member
  ON public.survey_invitations(member_id, created_at DESC);

-- ── 3. RLS 활성화 ────────────────────────────────────────────
ALTER TABLE public.survey_invitations ENABLE ROW LEVEL SECURITY;

-- ── 4. GRANT ─────────────────────────────────────────────────
GRANT ALL    ON public.survey_invitations TO service_role;
GRANT SELECT ON public.survey_invitations TO authenticated;
-- anon 직접 접근 불가 — RPC(SECURITY DEFINER)로만 열람/응답

-- ── 5. RLS 정책 (SELECT 전용 — INSERT/UPDATE는 service_role/RPC) ──
CREATE POLICY survey_invitations_hq_select ON public.survey_invitations
  FOR SELECT TO authenticated
  USING (is_hq_admin());

CREATE POLICY survey_invitations_branch_select ON public.survey_invitations
  FOR SELECT TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id());

-- ============================================================
-- RPC 1: get_survey_invite
-- 목적 : 개인 토큰으로 설문을 열람한다. (get_public_survey 확장판)
--        - QR/템플릿 유효성 검증
--        - 회원 이름(인사말용)·응답완료 여부 반환
--        - 최초 열람 시 status=opened, opened_at 기록
-- 보안 : SECURITY DEFINER + anon 허용
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_survey_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv      public.survey_invitations%ROWTYPE;
  v_qr       public.survey_qr_codes%ROWTYPE;
  v_template public.survey_templates%ROWTYPE;
  v_branch   record;
  v_member   record;
  v_result   JSONB;
BEGIN
  -- 1. 초대 조회
  SELECT * INTO v_inv
  FROM public.survey_invitations
  WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVITE_NOT_FOUND');
  END IF;

  -- 2. QR 조회 + 상태/기간 검증
  SELECT * INTO v_qr
  FROM public.survey_qr_codes
  WHERE id = v_inv.qr_code_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR_NOT_FOUND');
  END IF;
  IF v_qr.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR_INACTIVE');
  END IF;
  IF v_qr.valid_until IS NOT NULL AND NOW() > v_qr.valid_until THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR_EXPIRED');
  END IF;
  IF NOW() < v_qr.valid_from THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR_NOT_YET_VALID');
  END IF;

  -- 3. 템플릿 조회
  SELECT * INTO v_template
  FROM public.survey_templates
  WHERE id = v_inv.survey_template_id;

  IF NOT FOUND OR v_template.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SURVEY_INACTIVE');
  END IF;

  -- 4. 지점명 / 회원 이름 (개인정보 최소화 — 이름만)
  SELECT name INTO v_branch FROM public.branches WHERE id = v_inv.branch_id;
  SELECT name INTO v_member FROM public.members  WHERE id = v_inv.member_id;

  -- 5. 최초 열람 기록 (pending/sent → opened)
  IF v_inv.status IN ('pending', 'sent') THEN
    UPDATE public.survey_invitations
    SET status = 'opened', opened_at = COALESCE(opened_at, NOW())
    WHERE id = v_inv.id;
  END IF;

  -- 6. 결과 조립
  SELECT jsonb_build_object(
    'success',       true,
    'invite_token',  v_inv.token,
    'qr_code_id',    v_qr.id,
    'branch_name',   COALESCE(v_branch.name, '153 Boxing'),
    'member_name',   COALESCE(v_member.name, NULL),
    'already_responded', (v_inv.status = 'responded'),
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

GRANT EXECUTE ON FUNCTION public.get_survey_invite(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_survey_invite(TEXT) TO authenticated;

-- ============================================================
-- RPC 2: submit_survey_via_invite
-- 목적 : 개인 토큰으로 설문 응답을 제출한다.
--        - 응답을 초대의 member_id에 자동 귀속
--        - 초대 status=responded, response_id 연결
--        - 이미 응답한 초대는 거절 (중복 응답 방지)
-- 보안 : SECURITY DEFINER + anon 허용
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_survey_via_invite(
  p_token   TEXT,
  p_answers JSONB   -- [{question_id, answer_text?, answer_score?}]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv         public.survey_invitations%ROWTYPE;
  v_qr          public.survey_qr_codes%ROWTYPE;
  v_template    public.survey_templates%ROWTYPE;
  v_response_id UUID;
  v_answer      JSONB;
  v_question    public.survey_questions%ROWTYPE;
BEGIN
  -- 1. 초대 조회
  SELECT * INTO v_inv
  FROM public.survey_invitations
  WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVITE_NOT_FOUND');
  END IF;

  -- 2. 중복 응답 차단
  IF v_inv.status = 'responded' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_RESPONDED');
  END IF;

  -- 3. QR 검증
  SELECT * INTO v_qr
  FROM public.survey_qr_codes
  WHERE id = v_inv.qr_code_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR_NOT_FOUND');
  END IF;
  IF v_qr.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR_INACTIVE');
  END IF;
  IF v_qr.valid_until IS NOT NULL AND NOW() > v_qr.valid_until THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR_EXPIRED');
  END IF;

  -- 4. 템플릿 검증
  SELECT * INTO v_template
  FROM public.survey_templates
  WHERE id = v_inv.survey_template_id;

  IF NOT FOUND OR v_template.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'SURVEY_INACTIVE');
  END IF;

  -- 5. 응답 헤더 삽입 (member_id 자동 귀속)
  INSERT INTO public.survey_responses (
    qr_code_id, branch_id, survey_template_id, member_id, respondent_phone
  ) VALUES (
    v_qr.id, v_inv.branch_id, v_inv.survey_template_id,
    v_inv.member_id, v_inv.recipient_phone
  )
  RETURNING id INTO v_response_id;

  -- 6. 답변 삽입 (해당 템플릿 질문만 허용)
  FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    SELECT * INTO v_question
    FROM public.survey_questions
    WHERE id = (v_answer->>'question_id')::UUID
      AND survey_template_id = v_inv.survey_template_id;

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

  -- 7. 초대 상태 갱신
  UPDATE public.survey_invitations
  SET status       = 'responded',
      responded_at = NOW(),
      response_id  = v_response_id,
      opened_at    = COALESCE(opened_at, NOW())
  WHERE id = v_inv.id;

  RETURN jsonb_build_object('success', true, 'response_id', v_response_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_survey_via_invite(TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_survey_via_invite(TEXT, JSONB) TO authenticated;

-- ============================================================
-- RPC 3: get_survey_invite_stats
-- 목적 : 설문 템플릿별 발송/열람/응답 통계 + 최근 발송 목록
-- 보안 : SECURITY DEFINER + authenticated 전용 (지점/HQ 권한 검증)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_survey_invite_stats(
  p_survey_template_id UUID
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
  SELECT * INTO v_template
  FROM public.survey_templates
  WHERE id = p_survey_template_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'TEMPLATE_NOT_FOUND');
  END IF;

  -- 권한 확인
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

  SELECT jsonb_build_object(
    'success', true,
    'template_id', p_survey_template_id,
    'counts', jsonb_build_object(
      'total',     COUNT(*),
      'sent',      COUNT(*) FILTER (WHERE status IN ('sent','opened','responded')),
      'opened',    COUNT(*) FILTER (WHERE status IN ('opened','responded')),
      'responded', COUNT(*) FILTER (WHERE status = 'responded'),
      'failed',    COUNT(*) FILTER (WHERE status = 'failed')
    ),
    'recent', (
      SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT i.id, i.channel, i.status, i.sent_at, i.opened_at,
               i.responded_at, i.error_message, i.created_at,
               m.name AS member_name, i.recipient_phone
        FROM public.survey_invitations i
        JOIN public.members m ON m.id = i.member_id
        WHERE i.survey_template_id = p_survey_template_id
        ORDER BY i.created_at DESC
        LIMIT 200
      ) t
    )
  ) INTO v_result
  FROM public.survey_invitations
  WHERE survey_template_id = p_survey_template_id;

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_survey_invite_stats(UUID) TO authenticated;

-- ============================================================
DO $$
BEGIN
  RAISE NOTICE 'survey_invitations migration complete: 1 table, 1 column, 3 RPCs';
END;
$$;

-- ============================================================
-- FC AI Care Center 4차-①: 메시지 안전 검증
-- ============================================================
-- message_suggestions 에 안전 상태 컬럼 추가
-- check_message_safety()  : 외모/체중 비하·과도한 압박 표현 탐지
-- 트리거                  : 본문 생성·수정 시 안전상태 자동 채움
-- approve_message_suggestion() : block 메시지 일반 승인 차단
--                                (조직 관리자 강제 승인은 허용)
-- ============================================================

-- ── 안전 컬럼 ───────────────────────────────────────────────
ALTER TABLE public.message_suggestions
  ADD COLUMN IF NOT EXISTS safety_status text NOT NULL DEFAULT 'pass'
    CHECK (safety_status IN ('pass','warn','block')),
  ADD COLUMN IF NOT EXISTS safety_flags  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sent_at       timestamptz;

-- ── check_message_safety ────────────────────────────────────
-- 반환: { "status": pass|warn|block, "flags": [{type,term,severity}, ...] }
CREATE OR REPLACE FUNCTION public.check_message_safety(p_text text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_flags  jsonb := '[]'::jsonb;
  v_status text := 'pass';
  v_term   text;
  -- 외모·체중 비하 → 즉시 차단(block)
  v_block  text[] := ARRAY[
    '뚱뚱','비만','뱃살','똥배','군살','살을 빼','살 빼','살빼',
    '체중 감량','감량하','몸매 관리','외모','못생','날씬해지'];
  -- 과도한 압박 → 경고(warn)
  v_warn   text[] := ARRAY[
    '마지막 기회','지금 당장','당장 등록','당장 결제','더 이상 늦',
    '늦으면','놓치면 후회','후회하지','후회합니다','반드시 지금',
    '꼭 하셔야','안 하면 손해'];
BEGIN
  IF p_text IS NULL OR length(trim(p_text)) = 0 THEN
    RETURN jsonb_build_object('status','pass','flags','[]'::jsonb);
  END IF;

  FOREACH v_term IN ARRAY v_block LOOP
    IF p_text ILIKE '%'||v_term||'%' THEN
      v_flags := v_flags || jsonb_build_object(
        'type','appearance', 'term',v_term, 'severity','block');
      v_status := 'block';
    END IF;
  END LOOP;

  FOREACH v_term IN ARRAY v_warn LOOP
    IF p_text ILIKE '%'||v_term||'%' THEN
      v_flags := v_flags || jsonb_build_object(
        'type','pressure', 'term',v_term, 'severity','warn');
      IF v_status <> 'block' THEN v_status := 'warn'; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('status', v_status, 'flags', v_flags);
END $$;

GRANT EXECUTE ON FUNCTION public.check_message_safety(text)
  TO authenticated, service_role;

-- ── 트리거: 본문 변경 시 안전상태 자동 채움 ─────────────────
CREATE OR REPLACE FUNCTION public.fill_message_safety()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  v := public.check_message_safety(NEW.generated_body);
  NEW.safety_status := v->>'status';
  NEW.safety_flags  := v->'flags';
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER trg_msg_suggestions_safety
  BEFORE INSERT OR UPDATE OF generated_body ON public.message_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.fill_message_safety();

-- 기존 행 백필
UPDATE public.message_suggestions ms SET
  safety_status = (public.check_message_safety(ms.generated_body)->>'status'),
  safety_flags  = (public.check_message_safety(ms.generated_body)->'flags');

-- ── approve_message_suggestion ──────────────────────────────
-- draft → approved. safety_status='block' 은 조직 관리자 강제승인만 허용.
CREATE OR REPLACE FUNCTION public.approve_message_suggestion(
  p_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ms      public.message_suggestions%ROWTYPE;
  v_profile uuid;
BEGIN
  SELECT * INTO v_ms FROM public.message_suggestions WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','메시지를 찾을 수 없습니다');
  END IF;
  IF NOT public.has_branch_access(v_ms.branch_id) THEN
    RETURN jsonb_build_object('success',false,'error','접근 권한이 없습니다');
  END IF;
  IF v_ms.status <> 'draft' THEN
    RETURN jsonb_build_object('success',false,'error','이미 처리된 메시지입니다');
  END IF;
  IF v_ms.safety_status = 'block'
     AND NOT (p_force AND public.is_org_admin()) THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','안전 검증을 통과하지 못한 메시지입니다. 관리자 강제 승인이 필요합니다.',
      'safety_flags', v_ms.safety_flags);
  END IF;

  SELECT id INTO v_profile FROM public.profiles WHERE auth_user_id = auth.uid();
  UPDATE public.message_suggestions
    SET status='approved', approved_by=v_profile, approved_at=now()
    WHERE id = p_id;
  RETURN jsonb_build_object('success',true);
END $$;

REVOKE EXECUTE ON FUNCTION public.approve_message_suggestion(uuid, boolean)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_message_suggestion(uuid, boolean)
  TO authenticated, service_role;

DO $$ BEGIN
  RAISE NOTICE 'FC 4차-①: message_suggestions 안전검증 완료';
END $$;

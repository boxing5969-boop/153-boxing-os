-- ============================================================
-- 마이복서앱 회원가입(신규 등록) — 153 OS 회원 마스터 생성
-- ------------------------------------------------------------
-- 마이복서앱(랭킹업앱)에서 회원이 가입하면, 파트너 백엔드가 153 OS
-- external API 를 호출 → 본 RPC 로 members 마스터를 만든다.
--  · 앱유저ID(ranking_app_user_id) 1:1, 멱등(같은 앱유저/전화 재호출 시 중복생성 안 함)
--  · 신규는 status 'trial'(체험) + visitor_requests(registration) 상담리드 + consent_records
--  · 모든 쓰기는 service_role 만 실행(파트너 인증된 워커 경유)
-- 기존 결제/회원권/출입 로직과 독립(병행).
-- ============================================================

-- 1) 가입 경로 표식 + 앱유저 1:1 인덱스
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS signup_source text NOT NULL DEFAULT 'manual';

CREATE UNIQUE INDEX IF NOT EXISTS uq_members_ranking_app_user
  ON public.members(ranking_app_user_id)
  WHERE ranking_app_user_id IS NOT NULL;

-- 2) 회원가입 RPC (SECURITY DEFINER, service_role 전용)
CREATE OR REPLACE FUNCTION public.app_register_member(
  _ranking_user_id  uuid,
  _branch_id        uuid,
  _name             text,
  _phone            text,
  _birth            date    DEFAULT NULL,
  _gender           text    DEFAULT NULL,
  _agree_privacy    boolean DEFAULT false,
  _agree_terms      boolean DEFAULT false,
  _agree_marketing  boolean DEFAULT false
) RETURNS public.members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _company_id uuid;
  _member     public.members;
  _norm       text;
BEGIN
  -- 필수 동의 가드
  IF _agree_privacy IS NOT TRUE OR _agree_terms IS NOT TRUE THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED: 개인정보·이용약관 동의가 필요합니다';
  END IF;
  IF coalesce(btrim(_name), '') = '' THEN
    RAISE EXCEPTION 'NAME_REQUIRED: 이름이 필요합니다';
  END IF;

  SELECT company_id INTO _company_id FROM public.branches WHERE id = _branch_id;
  IF _company_id IS NULL THEN
    RAISE EXCEPTION 'BRANCH_NOT_FOUND: 지점을 찾을 수 없습니다';
  END IF;

  _norm := regexp_replace(coalesce(_phone, ''), '\D', '', 'g');

  -- (a) 앱유저ID 로 기존 회원 매칭
  SELECT * INTO _member FROM public.members
   WHERE ranking_app_user_id = _ranking_user_id
   LIMIT 1;

  -- (b) 없으면 전화번호+지점으로 기존 회원 매칭(중복 생성 방지 → 연결)
  IF _member.id IS NULL AND _norm <> '' THEN
    SELECT * INTO _member FROM public.members
     WHERE branch_id = _branch_id
       AND ranking_app_user_id IS NULL
       AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = _norm
     ORDER BY created_at ASC
     LIMIT 1;
  END IF;

  IF _member.id IS NULL THEN
    -- 신규 회원(체험)
    INSERT INTO public.members(
      company_id, branch_id, name, phone, birth_date, gender,
      status, ranking_app_user_id, signup_source
    ) VALUES (
      _company_id, _branch_id, _name, _phone, _birth, _gender,
      'trial', _ranking_user_id, 'app'
    ) RETURNING * INTO _member;

    -- 신규 상담 리드(경영 리포트 노출)
    INSERT INTO public.visitor_requests(branch_id, name, phone, purpose, status)
    VALUES (_branch_id, _name, _phone, 'registration', 'requested');
  ELSE
    -- 기존 회원 → 앱 연결만(중복 생성 방지)
    UPDATE public.members SET
      ranking_app_user_id = _ranking_user_id,
      name       = coalesce(nullif(btrim(_name), ''), name),
      phone      = coalesce(nullif(_norm, ''), phone),
      birth_date = coalesce(_birth, birth_date),
      gender     = coalesce(_gender, gender),
      updated_at = now()
    WHERE id = _member.id
    RETURNING * INTO _member;
  END IF;

  -- 동의 기록(개인정보·약관 필수 + 마케팅 선택)
  INSERT INTO public.consent_records(member_id, consent_type, agreed)
  VALUES (_member.id, 'privacy', true),
         (_member.id, 'terms',   true),
         (_member.id, 'marketing', _agree_marketing);

  RETURN _member;
END;
$$;

REVOKE ALL ON FUNCTION public.app_register_member(uuid,uuid,text,text,date,text,boolean,boolean,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_register_member(uuid,uuid,text,text,date,text,boolean,boolean,boolean) TO service_role;

-- 3) (Phase 1 검증용) 선릉점 MOCK 안면인식 단말기 시드
--    브로제이 API 받으면 vendor 를 'broj' 로 바꾸거나 실 단말기로 교체.
INSERT INTO public.access_devices(branch_id, device_name, device_type, vendor, status)
SELECT '5a4e9165-38b6-4e4e-8e6d-62d5cf1ce850', '선릉 안면인식 (MOCK·브로제이 연동 대기)', 'face_terminal', 'mock', 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.access_devices
   WHERE branch_id = '5a4e9165-38b6-4e4e-8e6d-62d5cf1ce850'
     AND device_name = '선릉 안면인식 (MOCK·브로제이 연동 대기)'
);

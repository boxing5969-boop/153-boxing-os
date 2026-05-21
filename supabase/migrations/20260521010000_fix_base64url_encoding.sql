-- ============================================================
-- Fix: encode() 'base64url' 미지원 → 'hex' 로 교체
-- ============================================================
-- PostgreSQL의 encode() 함수는 base64 / hex / escape 만 지원하며
-- 'base64url' 은 인식하지 못한다(ERROR: unrecognized encoding "base64url").
-- 이 때문에 아래 두 컬럼의 기본값이 평가될 때마다 INSERT가 실패했다.
--   - survey_qr_codes.slug   → QR 발급 전부 실패
--   - survey_invitations.token → 설문 발송(초대) 생성 실패
-- hex 는 URL-safe 하므로 slug/token 용도에 안전하다.
-- 두 테이블 모두 적용 시점 기존 행 0건이라 데이터 영향 없음.
-- ============================================================

ALTER TABLE public.survey_qr_codes
  ALTER COLUMN slug SET DEFAULT encode(gen_random_bytes(9), 'hex');

ALTER TABLE public.survey_invitations
  ALTER COLUMN token SET DEFAULT encode(gen_random_bytes(16), 'hex');

DO $$
BEGIN
  RAISE NOTICE 'base64url → hex 교체 완료: survey_qr_codes.slug, survey_invitations.token';
END;
$$;

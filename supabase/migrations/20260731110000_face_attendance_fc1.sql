-- FC-1: 153OS 얼굴 출석 백엔드 (2026-07-31 운영 적용 완료)
-- 인식은 키오스크 브라우저(온디바이스), 판단·기록은 153OS.
-- 얼굴 사진 저장 금지 — 128차원 특징값만. access_logs·consent_records 는 기존 설계 재사용.
CREATE TABLE IF NOT EXISTS public.internal_config (
  key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.internal_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.internal_config FROM PUBLIC, anon, authenticated;
INSERT INTO public.internal_config (key, value)
VALUES ('face_kiosk_key', encode(gen_random_bytes(24),'hex'))
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.face_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  embedding   double precision[] NOT NULL,
  consent_at  timestamptz NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.face_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.face_profiles FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_face_profiles_member ON public.face_profiles (member_id) WHERE active;

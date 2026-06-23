-- ============================================================
-- member_profiles — 회원 확장 프로필 (외부 명단의 모든 필드 보존)
-- ============================================================
-- 기존 members/memberships/consent_records 에 자리 없는 항목을 한 칸도
-- 빠짐없이 담는다. 원본 행 전체는 raw(jsonb)에 보존.
-- members 와 1:1. 회원 삭제 시 함께 삭제(CASCADE).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.member_profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id          uuid NOT NULL UNIQUE REFERENCES public.members(id) ON DELETE CASCADE,
  new_or_re          text,          -- 신규/재등록
  locker             text,          -- 보유 락커
  rental             text,          -- 보유/만료 대여권
  cumulative_payment numeric,       -- 누적 결제 금액
  last_purchase_date date,          -- 마지막 구매일
  mileage            text,          -- 보유 마일리지
  coupons            text,          -- 보유 유효 쿠폰
  broj_runtalk       text,          -- BROJ 운톡
  attendance_no      text,          -- 출석 번호
  notes              text,          -- 특이사항
  visit_route        text,          -- 방문 경로
  exercise_purpose   text,          -- 운동 목적
  address            text,          -- 간단 주소
  coach_name         text,          -- 상담 담당자(이름)
  status_orig        text,          -- 원본 상태(활성/만료/홀딩/미등록/임박/예정)
  raw                jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 원본 행 전체
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_profiles_member ON public.member_profiles(member_id);

CREATE OR REPLACE TRIGGER trg_member_profiles_updated_at
  BEFORE UPDATE ON public.member_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.member_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_profiles TO authenticated;

CREATE POLICY member_profiles_read ON public.member_profiles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.members m
                 WHERE m.id = member_profiles.member_id AND public.has_org_access(m.company_id)));
CREATE POLICY member_profiles_write ON public.member_profiles FOR ALL TO authenticated
  USING (public.is_org_admin()) WITH CHECK (public.is_org_admin());

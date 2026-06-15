-- ============================================================
-- 만료 임박 회원 팔로업 보드 (신규 1테이블 — 기존 스키마 불변)
--   member_followups : 지점장이 만료 임박 회원을 수동 등록하고
--                      대면/통화/문자·결과를 체크한다.
-- 접근: 모든 읽기/쓰기는 Workers API(service_role) 경유. RLS 활성(클라 직접 차단).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.member_followups (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid        NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_name   text        NOT NULL,
  expire_date   date,
  met_inperson  boolean     NOT NULL DEFAULT false,
  called        boolean     NOT NULL DEFAULT false,
  texted        boolean     NOT NULL DEFAULT false,
  status        text        NOT NULL DEFAULT '진행중',  -- 진행중 / 연장 / 보류 / 실패
  memo          text,
  created_by    uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS member_followups_branch_idx
  ON public.member_followups (branch_id, created_at DESC);
ALTER TABLE public.member_followups ENABLE ROW LEVEL SECURITY;

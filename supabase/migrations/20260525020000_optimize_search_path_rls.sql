-- ============================================================
-- 최적화: 트리거 함수 search_path 고정 + RLS 정책 성능
-- ============================================================
-- 1) function_search_path_mutable 경고 해소 — set_updated_at /
--    block_modify / set_response_anonymity 에 search_path 고정.
-- 2) auth_rls_initplan — tasks 담당자 정책의 auth.uid() 를
--    (select auth.uid()) 로 감싸 행마다 재평가되지 않도록 함.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.block_modify()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'append-only 테이블입니다: % 은(는) 수정/삭제할 수 없습니다', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_response_anonymity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.is_anonymous := (NEW.member_id IS NULL AND NEW.respondent_phone IS NULL);
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS tasks_assignee_select ON public.tasks;
CREATE POLICY tasks_assignee_select ON public.tasks FOR SELECT TO authenticated
  USING (assigned_to IN (
    SELECT id FROM public.profiles WHERE auth_user_id = (select auth.uid())
  ));

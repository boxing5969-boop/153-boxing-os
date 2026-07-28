-- ============================================================
-- 홀딩 자동 해제 — hold_end 경과한 일시정지 회원권을 자동 재개
-- ------------------------------------------------------------
-- paused + hold_end < 오늘 → active 로 복귀 + 출입권한 재활성 + 단말기 재동기화.
-- memberships_sync_trigger 에는 paused→active 분기가 없어 재개 동기화를
-- 명시적으로 처리한다(enqueue update_user + access_grants active + members active).
-- 일일 크론(Workers)에서 호출. service_role 전용.
-- ============================================================
CREATE OR REPLACE FUNCTION public.resume_due_holds()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ms record;
  _n  int := 0;
BEGIN
  FOR _ms IN
    SELECT id, member_id, end_date
      FROM public.memberships
     WHERE status = 'paused'
       AND hold_end IS NOT NULL
       AND hold_end < CURRENT_DATE
  LOOP
    UPDATE public.memberships
       SET status = 'active', hold_start = NULL, hold_end = NULL, updated_at = now()
     WHERE id = _ms.id;

    -- 출입권한 재활성(만료일은 연장분 반영해 회원권 종료일로 맞춤)
    UPDATE public.access_grants
       SET status = 'active', valid_until = _ms.end_date
     WHERE member_id = _ms.member_id
       AND grant_type = 'membership'
       AND status = 'suspended';

    -- 회원 상태 복귀(홀딩으로 suspended 된 경우만)
    UPDATE public.members
       SET status = 'active'
     WHERE id = _ms.member_id AND status = 'suspended';

    -- 단말기 재동기화(출입 재개)
    PERFORM public.enqueue_member_sync(_ms.member_id, 'update_user');

    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.resume_due_holds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_due_holds() TO service_role;

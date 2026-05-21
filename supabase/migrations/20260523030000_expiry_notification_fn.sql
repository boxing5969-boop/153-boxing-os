-- ============================================================
-- 2차: 만료 예정 회원 알림 예약 함수
-- ============================================================
-- schedule_expiry_notifications() : D-30/14/7/1 만료 예정 회원을
--   찾아 message_jobs 큐에 알림톡 작업을 예약한다(즉시 발송 아님).
-- 멱등 키 'expiry:{membership_id}:d{N}' 로 재실행해도 중복 예약 없음.
-- 실제 발송은 다음 단계(워커)에서 message_jobs 를 소비해 처리.
-- 매일 자동 실행(cron)도 다음 단계에서 연결.
-- ============================================================

CREATE OR REPLACE FUNCTION public.schedule_expiry_notifications(
  p_branch_id uuid DEFAULT NULL    -- NULL = 전체 지점
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_days  int;
  v_count int := 0;
  r       record;
BEGIN
  FOREACH v_days IN ARRAY ARRAY[30,14,7,1]
  LOOP
    FOR r IN
      SELECT ms.id AS membership_id, ms.member_id, ms.branch_id,
             ms.end_date, m.name AS member_name, m.phone
      FROM public.memberships ms
      JOIN public.members m ON m.id = ms.member_id
      WHERE ms.status = 'active'
        AND ms.deleted_at IS NULL
        AND ms.end_date = v_today + v_days
        AND (p_branch_id IS NULL OR ms.branch_id = p_branch_id)
    LOOP
      PERFORM public.enqueue_message_job(
        r.branch_id,
        'kakao',
        'membership_expiry_d' || v_days,
        r.member_id,
        jsonb_build_object(
          'member_name', r.member_name,
          'end_date',    r.end_date,
          'days_left',   v_days
        ),
        now(),
        r.phone,
        'expiry:' || r.membership_id || ':d' || v_days
      );
      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'base_date', v_today,
    'scheduled', v_count
  );
END $$;

GRANT EXECUTE ON FUNCTION public.schedule_expiry_notifications(uuid)
  TO authenticated, service_role;

DO $$ BEGIN
  RAISE NOTICE 'schedule_expiry_notifications 함수 생성 완료';
END $$;

-- 결제 상태 변경 시 단말기 동기화를 '최종 회원 상태' 기준으로 확정한다.
--
-- 문제 1) memberships 트리거는 이용권 변화만 보고 큐를 넣는다.
--   이미 만료된 이용권(end_date 과거)을 납부확인하면 트리거는 update_user(활성화)를 넣지만
--   회원 최종 상태는 expired 다 → CRM 은 만료인데 단말기는 열린다(출입통제 괴리).
-- 문제 2) 같은 트랜잭션에서 넣은 두 작업은 created_at 이 동일해(now() 고정)
--   처리 순서가 보장되지 않는다. 운 나쁘면 '활성화'가 나중에 처리된다.
-- 문제 3) 이미 미납인 건을 재차 미납 처리하면 트리거 전이 조건에 안 걸려 큐가 안 생겼다.
--
-- 해결: 최종 판정 직전에 그 회원의 pending 작업을 비우고 결론 1건만 넣는다.
--   processing/success/failed 기록은 건드리지 않는다(감사·재시도 이력 보존).
--
-- 실데이터 검증(2026-08-04): 만료납부→expired/disable, 유효납부→active/update,
--   정상→미납→unpaid/disable, 각 pending 1건. 3케이스 통과.

CREATE OR REPLACE FUNCTION public.enqueue_member_sync_final(_member_id uuid, _job_type sync_job_type)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE inserted int := 0;
BEGIN
  DELETE FROM device_sync_jobs
   WHERE target_member_id = _member_id
     AND status = 'pending';

  INSERT INTO device_sync_jobs (branch_id, device_id, job_type, target_member_id, status)
  SELECT d.branch_id, d.id, _job_type, _member_id, 'pending'
  FROM device_users du
  JOIN access_devices d ON d.id = du.device_id
  WHERE du.member_id = _member_id;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END $function$;

REVOKE EXECUTE ON FUNCTION public.enqueue_member_sync_final(uuid, sync_job_type) FROM PUBLIC, anon;

-- ⚠️ 아래 두 함수 전문은 반드시 여기 있어야 한다.
--    예전에는 "운영 DB 에서 확인하라"는 주석만 남겼는데, 그러면 새 환경에서
--    마이그레이션을 재생할 때 20260804050000 버전(단말기 동기화 호출이 없는 함수)이
--    만들어져 **미납 처리해도 출입이 안 막히는** 상태가 조용히 재현된다.
--    (CLAUDE.md 절대원칙 6 — 미납·정지도 출입 차단)

CREATE OR REPLACE FUNCTION public.set_membership_paid(_membership_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_member_id uuid;
  v_member_status text;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_has_active boolean;
  v_has_trial boolean;
  v_new_status text;
  v_updated int;
begin
  update public.memberships
     set payment_status = 'paid', updated_at = now()
   where id = _membership_id
  returning member_id into v_member_id;

  if v_member_id is null then
    raise exception '이용권을 찾지 못했거나 권한이 없습니다';
  end if;

  select status::text into v_member_status from public.members where id = v_member_id;
  if v_member_status is null then
    raise exception '회원 정보를 볼 권한이 없어 처리를 중단했습니다';
  end if;

  -- 홀딩·탈퇴는 납부와 무관하게 유지 (홀딩 세탁 차단) + 단말기도 차단 상태로 확정
  if v_member_status in ('suspended', 'withdrawn') then
    perform public.enqueue_member_sync_final(v_member_id, 'disable_user');
    return jsonb_build_object('member_id', v_member_id, 'member_status', v_member_status);
  end if;

  select exists (
    select 1 from public.memberships m
     where m.member_id = v_member_id
       and m.status = 'active'
       and m.end_date >= v_today
       and m.payment_status in ('paid', 'partial')
  ) into v_has_active;

  select exists (
    select 1 from public.trial_passes t
     where t.member_id = v_member_id
       and t.status = 'active'
       and t.end_at >= now()
       and t.used_entries < t.max_entries
  ) into v_has_trial;

  v_new_status := case when v_has_active or v_has_trial then 'active' else 'expired' end;

  update public.members
     set status = v_new_status::member_status, updated_at = now()
   where id = v_member_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception '회원 상태를 바꿀 권한이 없어 처리를 중단했습니다';
  end if;

  -- 최종 상태로 단말기 동기화 확정 (트리거가 넣은 작업을 덮어쓴다)
  if v_new_status = 'active' then
    perform public.enqueue_member_sync_final(v_member_id, 'update_user');
  else
    perform public.enqueue_member_sync_final(v_member_id, 'disable_user');
  end if;

  return jsonb_build_object('member_id', v_member_id, 'member_status', v_new_status);
end $function$;

CREATE OR REPLACE FUNCTION public.set_membership_unpaid(_membership_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_member_id uuid;
  v_member_status text;
  v_updated int;
begin
  update public.memberships
     set payment_status = 'unpaid', updated_at = now()
   where id = _membership_id
  returning member_id into v_member_id;

  if v_member_id is null then
    raise exception '이용권을 찾지 못했거나 권한이 없습니다';
  end if;

  select status::text into v_member_status from public.members where id = v_member_id;
  if v_member_status is null then
    raise exception '회원 정보를 볼 권한이 없어 처리를 중단했습니다';
  end if;

  if v_member_status not in ('suspended', 'withdrawn') then
    update public.members
       set status = 'unpaid'::member_status, updated_at = now()
     where id = v_member_id;
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      raise exception '회원 상태를 바꿀 권한이 없어 처리를 중단했습니다';
    end if;
    v_member_status := 'unpaid';
  end if;

  -- 미납·홀딩·탈퇴는 모두 출입 차단 — 이미 미납이던 건을 재처리해도 확실히 막는다
  perform public.enqueue_member_sync_final(v_member_id, 'disable_user');

  return jsonb_build_object('member_id', v_member_id, 'member_status', v_member_status);
end $function$;

REVOKE EXECUTE ON FUNCTION public.set_membership_unpaid(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_membership_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_membership_unpaid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_membership_paid(uuid) TO authenticated;

-- ── 롤백 ────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.enqueue_member_sync_final(uuid, sync_job_type);
-- 그리고 두 RPC 를 20260804050000 버전으로 CREATE OR REPLACE (동기화 호출 제거)

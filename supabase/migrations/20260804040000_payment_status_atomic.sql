-- 미납/납부 처리를 원자적으로 (출입통제 직결)
--
-- 배경: 프런트가 memberships 수정 → members 수정을 별도 2회 호출했다.
--   ① 두 번째가 실패하면 "이용권은 미납인데 회원은 정상" → 문이 계속 열린다.
--   ② 납부 확인이 members.status 를 무조건 'active' 로 덮어써서
--      홀딩(정지) 중인 회원의 미납을 처리하면 홀딩이 풀렸다(세탁 경로).
--
-- 변경: 두 갱신을 함수 하나로 묶고, 회원 상태는 '실제 이용권 상태'로 산출한다.
--   - 미납 처리: 이용권 payment_status='unpaid' + 회원 status='unpaid'
--                (단, 이미 홀딩·탈퇴인 회원의 상태는 건드리지 않는다)
--   - 납부 확인: 이용권 payment_status='paid' + 회원 status 재산출
--                (홀딩 중이면 홀딩 유지, 유효 이용권 있으면 active, 없으면 expired)
--
-- 검증 SQL·롤백은 파일 하단 참조.

CREATE OR REPLACE FUNCTION public.set_membership_unpaid(_membership_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER               -- 호출자 권한 = RLS 그대로 적용(권한 확대 없음)
 SET search_path TO 'public'
AS $function$
declare
  v_member_id uuid;
  v_member_status text;
begin
  update public.memberships
     set payment_status = 'unpaid', updated_at = now()
   where id = _membership_id
  returning member_id into v_member_id;

  if v_member_id is null then
    raise exception '이용권을 찾지 못했거나 권한이 없습니다';
  end if;

  -- members.status 는 enum 이라 text 비교/반환 시 명시 캐스트가 필요하다
  select status::text into v_member_status from public.members where id = v_member_id;

  -- 홀딩·탈퇴 상태는 유지(미납으로 덮어쓰면 홀딩 이력이 사라진다)
  if v_member_status not in ('suspended', 'withdrawn') then
    update public.members
       set status = 'unpaid'::member_status, updated_at = now()
     where id = v_member_id;
    v_member_status := 'unpaid';
  end if;

  return jsonb_build_object('member_id', v_member_id, 'member_status', v_member_status);
end $function$;

CREATE OR REPLACE FUNCTION public.set_membership_paid(_membership_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
declare
  v_member_id uuid;
  v_member_status text;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_has_active boolean;
  v_new_status text;
begin
  update public.memberships
     set payment_status = 'paid', updated_at = now()
   where id = _membership_id
  returning member_id into v_member_id;

  if v_member_id is null then
    raise exception '이용권을 찾지 못했거나 권한이 없습니다';
  end if;

  select status::text into v_member_status from public.members where id = v_member_id;

  -- 홀딩·탈퇴는 납부와 무관하게 유지 (홀딩 세탁 차단)
  if v_member_status in ('suspended', 'withdrawn') then
    return jsonb_build_object('member_id', v_member_id, 'member_status', v_member_status);
  end if;

  -- 회원 상태는 실제 이용권으로 산출한다
  select exists (
    select 1 from public.memberships m
     where m.member_id = v_member_id
       and m.status = 'active'
       and m.end_date >= v_today
       and m.payment_status in ('paid', 'partial')
  ) into v_has_active;

  v_new_status := case when v_has_active then 'active' else 'expired' end;

  -- members.status 는 member_status enum 이라 명시 캐스트가 필요하다
  update public.members
     set status = v_new_status::member_status, updated_at = now()
   where id = v_member_id;

  return jsonb_build_object('member_id', v_member_id, 'member_status', v_new_status);
end $function$;

-- ── 검증 SQL ────────────────────────────────────────────────
-- 홀딩 회원의 미납 처리 후에도 상태가 suspended 인지:
--   SELECT status FROM members WHERE id = '<홀딩 회원>';
-- 납부 확인 후 유효 이용권이 없으면 expired 인지:
--   SELECT set_membership_paid('<이용권 id>');
--
-- ── 롤백 ────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.set_membership_unpaid(uuid);
-- DROP FUNCTION IF EXISTS public.set_membership_paid(uuid);
-- (프런트가 예전처럼 2회 호출로 돌아가야 하므로 코드도 함께 되돌려야 한다)

-- 검수 반영 3건
--  ① member_snapshots 읽기 정책 — 회원 그룹 검색(만료·미출석)이 항상 0명이던 문제
--  ② 결제 상태 RPC 의 NULL 방어 — 회원 행이 안 보이면 조용히 넘어가던 문제
--  ③ 신규 RPC anon 실행 권한 회수 (레포 관례)

-- ── ① member_snapshots 읽기 정책 ────────────────────────────
-- 배경: RLS 는 켜져 있는데 정책이 하나도 없어(20260615050000) authenticated 는 항상 0행이었다.
--       그래서 CRM 의 회원 그룹 검색(7일 내 만료·미출석 등)이 오류 없이 "0명"으로만 나왔다.
-- 원칙: 쓰기는 계속 service_role 전용(브로제이 동기화). 읽기만 members 와 동일한 지점 범위로 연다.
--       명부에도 이름·전화가 있으므로 members 의 읽기 정책과 같은 수준을 유지한다.
DROP POLICY IF EXISTS member_snapshots_branch_read ON public.member_snapshots;
CREATE POLICY member_snapshots_branch_read ON public.member_snapshots
  FOR SELECT TO authenticated
  USING (has_branch_access(branch_id) AND NOT is_accountant_only());

DROP POLICY IF EXISTS member_snapshots_hq_read ON public.member_snapshots;
CREATE POLICY member_snapshots_hq_read ON public.member_snapshots
  FOR SELECT TO authenticated
  USING (is_hq_admin());

-- ── ② 결제 상태 RPC NULL 방어 ───────────────────────────────
-- v_member_status 가 NULL(회원 행이 RLS 로 안 보임)이면 `NULL not in (...)` 이 NULL 이 되어
-- members 갱신을 건너뛰고도 성공을 반환했다 — 고치려던 "이용권 미납 / 회원 정상"이 재현된다.
CREATE OR REPLACE FUNCTION public.set_membership_unpaid(_membership_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
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

  -- 홀딩·탈퇴는 납부와 무관하게 유지 (홀딩 세탁 차단)
  if v_member_status in ('suspended', 'withdrawn') then
    return jsonb_build_object('member_id', v_member_id, 'member_status', v_member_status);
  end if;

  select exists (
    select 1 from public.memberships m
     where m.member_id = v_member_id
       and m.status = 'active'
       and m.end_date >= v_today
       and m.payment_status in ('paid', 'partial')
  ) into v_has_active;

  -- 체험권만 있는 회원을 만료로 덮어쓰지 않는다(체험 출입이 끊긴다)
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

  return jsonb_build_object('member_id', v_member_id, 'member_status', v_new_status);
end $function$;

-- ── ③ anon 실행 권한 회수 (레포 관례) ───────────────────────
REVOKE EXECUTE ON FUNCTION public.set_membership_unpaid(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_membership_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_membership_unpaid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_membership_paid(uuid) TO authenticated;

-- ── 검증 SQL ────────────────────────────────────────────────
-- SELECT count(*) FROM pg_policies WHERE tablename='member_snapshots';  -- 2 이상
-- SELECT has_function_privilege('anon','public.set_membership_paid(uuid)','EXECUTE'); -- false
--
-- ── 롤백 ────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS member_snapshots_branch_read ON public.member_snapshots;
-- DROP POLICY IF EXISTS member_snapshots_hq_read ON public.member_snapshots;
-- (RPC 는 20260804040000 버전으로 CREATE OR REPLACE 하면 복귀)

-- 엑셀 회원 업로드가 '명부(member_snapshots)'에도 반영되게 한다
--
-- 배경: 지점 현황·홈·리포트의 회원 수는 member_snapshots(브로제이 명부)를 원장으로 센다.
--       그런데 수동 업로드(import_member_roster)는 members/memberships 에만 넣어서,
--       브로제이 API 연동이 없는 지점(종로·강남 등)은 엑셀을 올려도 숫자가 계속 0이었다.
--
-- 변경점: 회원 1명 처리할 때 member_snapshots 를 함께 upsert 한다.
--   - 매칭 키   : (branch_id, normalized_phone)  ※ normalized_phone 은 generated 컬럼
--   - source    : 'manual' (브로제이 API 동기화분 'broj' 와 구분 — 동기화 삭제로부터 보호)
--   - status    : 만료일 기준 KST 로 '유효'/'만료'/'미상' (brojSync.memberStatus 와 동일 규칙)
--   - end_date  : 업로드된 이용권 중 가장 늦은 종료일 / start_date: 가장 이른 시작일
--   - 전화번호 없는 행은 명부에 넣지 않는다(명부 키가 전화번호라 매칭 불가)
--
-- 안전: 기존 행이 있으면 id 를 유지한 채 UPDATE(케어·발송 이력 링크 보존).
--       브로제이 API 지점에서 업로드해도 같은 (지점,전화) 행을 갱신하므로 중복 집계가 없다.
-- 롤백: 이 파일 하단 주석의 "명부 반영 블록 제거" 안내 참조(원본 함수는 20260619000400 계열).

CREATE OR REPLACE FUNCTION public.import_member_roster(p_branch_id uuid, p_company_id uuid, p_brand_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb; m jsonb; v_member_id uuid;
  v_inserted int := 0; v_updated int := 0; v_memberships int := 0;
  -- 명부(member_snapshots) 반영용
  v_snap_id uuid; v_phone text; v_start date; v_end date; v_status text; v_today date;
  v_snapshots int := 0;
begin
  v_today := (now() at time zone 'Asia/Seoul')::date;

  for r in select value from jsonb_array_elements(p_rows) loop
    select id into v_member_id from public.members
      where company_id = p_company_id and phone = r->>'phone' and name = r->>'name' limit 1;
    if v_member_id is null then
      insert into public.members (company_id,branch_id,brand_id,name,phone,gender,birth_date,status,created_at)
      values (p_company_id,p_branch_id,p_brand_id, r->>'name', r->>'phone',
              nullif(r->>'gender',''), nullif(r->>'birth_date','')::date,
              (r->>'status')::member_status, coalesce(nullif(r->>'created_at','')::timestamptz, now()))
      returning id into v_member_id;
      v_inserted := v_inserted + 1;
    else
      update public.members set branch_id=p_branch_id, gender=nullif(r->>'gender',''),
        birth_date=nullif(r->>'birth_date','')::date, status=(r->>'status')::member_status
        where id = v_member_id;
      v_updated := v_updated + 1;
    end if;

    delete from public.memberships where member_id = v_member_id;
    for m in select value from jsonb_array_elements(coalesce(r->'memberships','[]'::jsonb)) loop
      if nullif(m->>'start','') is not null and nullif(m->>'end','') is not null then
        insert into public.memberships (member_id,branch_id,company_id,brand_id,plan_name,start_date,end_date,status,max_sessions)
        values (v_member_id,p_branch_id,p_company_id,p_brand_id, m->>'plan_name',
                (m->>'start')::date, (m->>'end')::date, (m->>'status')::membership_status, nullif(m->>'sessions','')::int);
        v_memberships := v_memberships + 1;
      end if;
    end loop;

    delete from public.consent_records where member_id=v_member_id and consent_type='marketing';
    insert into public.consent_records (member_id,consent_type,agreed,agreed_at)
    values (v_member_id,'marketing',(r->>'marketing_consent')::boolean,
            case when (r->>'marketing_consent')::boolean then now() end);

    insert into public.member_profiles (member_id,new_or_re,locker,rental,cumulative_payment,last_purchase_date,mileage,coupons,broj_runtalk,attendance_no,notes,visit_route,exercise_purpose,address,coach_name,status_orig)
    values (v_member_id, r->'profile'->>'new_or_re', r->'profile'->>'locker', r->'profile'->>'rental',
            nullif(r->'profile'->>'cumulative_payment','')::numeric, nullif(r->'profile'->>'last_purchase_date','')::date,
            r->'profile'->>'mileage', r->'profile'->>'coupons', r->'profile'->>'broj_runtalk', r->'profile'->>'attendance_no',
            r->'profile'->>'notes', r->'profile'->>'visit_route', r->'profile'->>'exercise_purpose', r->'profile'->>'address',
            r->'profile'->>'coach_name', r->'profile'->>'status_orig')
    on conflict (member_id) do update set
      new_or_re=excluded.new_or_re, locker=excluded.locker, rental=excluded.rental, cumulative_payment=excluded.cumulative_payment,
      last_purchase_date=excluded.last_purchase_date, mileage=excluded.mileage, coupons=excluded.coupons, broj_runtalk=excluded.broj_runtalk,
      attendance_no=excluded.attendance_no, notes=excluded.notes, visit_route=excluded.visit_route, exercise_purpose=excluded.exercise_purpose,
      address=excluded.address, coach_name=excluded.coach_name, status_orig=excluded.status_orig;

    if nullif(r->>'last_visit','') is not null
       and not exists (select 1 from public.access_logs where member_id=v_member_id and raw_event_id='roster_import') then
      insert into public.access_logs (member_id,branch_id,company_id,credential_type,result,occurred_at,raw_event_id)
      values (v_member_id,p_branch_id,p_company_id,'visitor','success',((r->>'last_visit')||'T09:00:00+09:00')::timestamptz,'roster_import');
    end if;

    -- ── 명부(member_snapshots) 반영 ────────────────────────────
    -- 지점 현황·홈·일일 리포트가 세는 원장. 전화번호가 있어야 매칭 키가 성립한다.
    v_phone := regexp_replace(coalesce(r->>'phone',''), '[^0-9]', '', 'g');
    if length(v_phone) >= 8 then
      -- 업로드된 이용권 중 가장 이른 시작일 / 가장 늦은 종료일
      select min(nullif(e->>'start','')::date), max(nullif(e->>'end','')::date)
        into v_start, v_end
        from jsonb_array_elements(coalesce(r->'memberships','[]'::jsonb)) e;

      -- 상태 표기는 브로제이 명부 규칙과 동일하게 (유효/만료/미상)
      v_status := case
        when v_end is null then '미상'
        when v_end >= v_today then '유효'
        else '만료'
      end;

      select id into v_snap_id from public.member_snapshots
        where branch_id = p_branch_id and normalized_phone = v_phone limit 1;

      if v_snap_id is null then
        insert into public.member_snapshots
          (branch_id, member_name, phone, membership_type, start_date, end_date,
           latest_visit_date, status, source, assigned_coach, raw_payload)
        values
          (p_branch_id, r->>'name', r->>'phone', r->'profile'->>'new_or_re', v_start, v_end,
           nullif(r->>'last_visit','')::date, v_status, 'manual', r->'profile'->>'coach_name',
           jsonb_build_object('joined_at', nullif(r->>'created_at','')::date,
                              'imported_at', now(),
                              'agree_advertisement', coalesce((r->>'marketing_consent')::boolean, false)));
      else
        update public.member_snapshots set
          member_name = r->>'name',
          phone = r->>'phone',
          membership_type = coalesce(r->'profile'->>'new_or_re', membership_type),
          start_date = coalesce(v_start, start_date),
          end_date = coalesce(v_end, end_date),
          latest_visit_date = coalesce(nullif(r->>'last_visit','')::date, latest_visit_date),
          status = v_status,
          assigned_coach = coalesce(r->'profile'->>'coach_name', assigned_coach),
          raw_payload = raw_payload || jsonb_build_object(
            'joined_at', coalesce(nullif(r->>'created_at','')::date, (raw_payload->>'joined_at')::date),
            'imported_at', now(),
            'agree_advertisement', coalesce((r->>'marketing_consent')::boolean, false)),
          updated_at = now()
        where id = v_snap_id;
      end if;
      v_snapshots := v_snapshots + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted',v_inserted,'updated',v_updated,'memberships',v_memberships,'snapshots',v_snapshots);
end $function$;

-- ── 검증 SQL ────────────────────────────────────────────────
-- 업로드 후: SELECT branch_name, active_members FROM get_hq_branch_stats();
-- 수동분만 보기: SELECT count(*) FROM member_snapshots WHERE source='manual';
--
-- ── 롤백 ────────────────────────────────────────────────────
-- 위 함수에서 "명부(member_snapshots) 반영" 블록(if length(v_phone) >= 8 ... end if;)을
-- 삭제하고 다시 CREATE OR REPLACE 하면 이전 동작으로 복귀한다(members 처리부는 동일).

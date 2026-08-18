-- 만료 회원 이탈 설문 자동 발송 (2026-08-11)
--
-- 만료 후 7일이 지나도 재등록하지 않은 회원에게 이탈 사유 설문 링크를 회원당 1회 보낸다.
-- 기존 설문 엔진(survey_templates/questions/qr_codes/invitations/responses)을 그대로 재사용하고
-- 여기서는 ① 지점 스위치 ② 이탈 설문 템플릿·문항 ③ 지점별 개인링크 슬러그
--          ④ member_id NOT NULL 완화 ⑤ 발송통계 LEFT JOIN 만 다룬다.
--
-- ⚠️ 이 파일이 없으면: 워커의 fc_automation_config select 에 exit_survey_enabled 가 들어 있어
--    컬럼이 없는 환경에서는 **모든 자동발송(온보딩·재등록·안부 포함)이 통째로 죽는다.**
--    라이브에만 있고 레포에 없던 상태를 검수에서 지적받아 뒤늦게 고정한다.

-- ── 1. 지점별 스위치 (기본 OFF — 문구 확인 후 사람이 켠다) ────────────────────
alter table public.fc_automation_config
  add column if not exists exit_survey_enabled boolean not null default false;

comment on column public.fc_automation_config.exit_survey_enabled is
  '만료 후 7일 미재등록 회원에게 이탈 설문 링크 자동 발송(회원당 1회)';

-- ── 2. survey_invitations.member_id 완화 ─────────────────────────────────────
--   발송 대상은 member_snapshots(브로제이 동기화본)에서 뽑는데 이 컬럼은 members(CRM 원장) FK 다.
--   두 테이블은 전화번호로만 이어지고, 선릉 실측 결과 만료 대상 6명 중 원장 매칭은 3명뿐이었다.
--   NOT NULL 을 유지하면 나머지 절반이 FK 위반으로 영영 설문을 못 받는다.
--   원장에 없는 사람을 새로 만들어 넣지는 않는다 — 자동발송이 회원수·통계를 오염시키면 안 된다.
alter table public.survey_invitations alter column member_id drop not null;

comment on column public.survey_invitations.member_id is
  'CRM members 원장 id. 브로제이 동기화 회원은 전화번호가 매칭되지 않으면 null — 이때는 recipient_phone 이 식별자다';

-- ── 3. 발송 통계가 원장 미매칭 초대를 빠뜨리지 않게 ───────────────────────────
--   기존 get_survey_invite_stats 의 recent 목록이 members 와 INNER JOIN 이라,
--   member_id 가 null 인 초대는 "6건 보냈는데 목록엔 3건"으로 보였다(직원이 발송 실패로 오해).
--   ⚠️ 원본을 그대로 옮기고 JOIN 한 줄만 바꾼다. 함수를 새로 쓰면 앞부분의 역할·지점 권한 검사를
--      빠뜨리기 쉽다(실제로 초안에서 빠뜨렸다). 아래는 기존 정의 + LEFT JOIN + 이름 폴백뿐이다.
create or replace function public.get_survey_invite_stats(p_survey_template_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
DECLARE
  v_template      public.survey_templates%ROWTYPE;
  v_caller_role   TEXT;
  v_caller_branch UUID;
  v_result        JSONB;
BEGIN
  SELECT * INTO v_template FROM public.survey_templates WHERE id = p_survey_template_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'TEMPLATE_NOT_FOUND');
  END IF;

  SELECT p.role, p.branch_id
  INTO v_caller_role, v_caller_branch
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid();

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;
  IF v_caller_role NOT IN ('super_admin', 'hq_admin') THEN
    IF v_caller_branch IS DISTINCT FROM v_template.branch_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'success', true,
    'template_id', p_survey_template_id,
    'counts', jsonb_build_object(
      'total',     COUNT(*),
      'sent',      COUNT(*) FILTER (WHERE status IN ('sent','opened','responded')),
      'opened',    COUNT(*) FILTER (WHERE status IN ('opened','responded')),
      'responded', COUNT(*) FILTER (WHERE status = 'responded'),
      'failed',    COUNT(*) FILTER (WHERE status = 'failed')
    ),
    'recent', (
      SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT i.id, i.channel, i.status, i.sent_at, i.opened_at,
               i.responded_at, i.error_message, i.created_at,
               -- 원장(members)에 없는 회원도 목록에 남긴다. INNER JOIN 이던 시절엔
               -- "6건 보냈는데 목록엔 3건"으로 보여 직원이 발송 실패로 오해했다.
               COALESCE(m.name, '(원장 미등록)') AS member_name, i.recipient_phone
        FROM public.survey_invitations i
        LEFT JOIN public.members m ON m.id = i.member_id
        WHERE i.survey_template_id = p_survey_template_id
        ORDER BY i.created_at DESC
        LIMIT 200
      ) t
    )
  ) INTO v_result
  FROM public.survey_invitations
  WHERE survey_template_id = p_survey_template_id;

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;

-- ── 4. 지점마다 이탈 설문 템플릿 + 문항 + 개인링크 슬러그 ─────────────────────
--   survey_templates.branch_id 는 NOT NULL — 설문은 지점 단위다. 자동화가 붙은 지점마다 하나씩.
--   문항 설계: 재등록 권유·할인 문구를 넣지 않는다. 영업이 섞이면 솔직한 답이 안 나온다.
--   1번은 options.choices 를 쓰는 진짜 객관식이다(공개 화면이 보기 버튼으로 그린다).
do $$
declare
  r     record;
  v_tid uuid;
begin
  for r in select branch_id from public.fc_automation_config loop
    select id into v_tid
      from public.survey_templates
     where branch_id = r.branch_id and title = '153복싱 만료 회원 설문';

    if v_tid is null then
      insert into public.survey_templates (branch_id, title, description, status)
      values (r.branch_id, '153복싱 만료 회원 설문',
              '이용이 끝난 회원께 여쭙는 짧은 설문입니다. 답변은 체육관 개선에만 쓰입니다.', 'active')
      returning id into v_tid;

      insert into public.survey_questions
        (survey_template_id, order_index, question_type, question_text, options, is_required)
      values
        (v_tid, 0, 'multiple_choice', '이용을 이어가지 않으신 가장 큰 이유는 무엇인가요?',
         jsonb_build_object('choices', jsonb_build_array(
           '시간이 잘 맞지 않아서', '거리·이동이 불편해서', '가격이 부담돼서',
           '운동 강도나 수업이 맞지 않아서', '코치·직원 응대가 아쉬워서',
           '시설·환경이 아쉬워서', '개인 사정(이사·부상·직장 등)', '기타'
         )), true),
        (v_tid, 1, 'rating', '다니시는 동안 전반적으로 얼마나 만족하셨나요?',
         jsonb_build_object('min',1,'max',5,'labels',jsonb_build_object('1','매우 불만족','5','매우 만족')), true),
        (v_tid, 2, 'rating', '코치의 지도는 어떠셨나요?',
         jsonb_build_object('min',1,'max',5,'labels',jsonb_build_object('1','매우 불만족','5','매우 만족')), true),
        (v_tid, 3, 'text', '저희가 무엇을 바꿨다면 계속 다니셨을까요? 편하게 적어주세요.', null, false),
        (v_tid, 4, 'yes_no', '나중에 여건이 되면 다시 이용하실 의향이 있으신가요?', null, true);
    end if;

    -- 개인 링크용 슬러그 1개 — 벽에 붙이는 QR 이 아니라 문자로만 나가는 링크다
    if not exists (
      select 1 from public.survey_qr_codes q
       where q.branch_id = r.branch_id and q.survey_template_id = v_tid
    ) then
      insert into public.survey_qr_codes (branch_id, survey_template_id, slug, label, qr_type, status)
      values (r.branch_id, v_tid, encode(gen_random_bytes(9), 'hex'),
              '만료 회원 설문(자동 발송)', 'member_personal', 'active');
    end if;
  end loop;
end $$;

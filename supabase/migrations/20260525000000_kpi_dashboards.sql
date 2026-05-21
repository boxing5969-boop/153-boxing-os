-- ============================================================
-- 4차: KPI 대시보드 RPC
-- ============================================================
-- get_hq_kpi_dashboard()          — 본사용 10개 KPI (super_admin/hq_admin 전용)
-- get_branch_ops_dashboard(uuid)  — 지점장용 7개 KPI (HQ 전체 / 지점관리자 자기지점)
-- 둘 다 SECURITY DEFINER + 명시적 권한검증 → RPC 자체가 접근통제 역할.
-- 각 지표의 계산 기준은 SQL 주석에 명시.
-- ============================================================

-- ── 본사용 KPI ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_hq_kpi_dashboard()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role    text;
  v_today   date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_m_start date := date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul'))::date;
  v_m_end   date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul'))
                     + interval '1 month - 1 day')::date;
  v_result  jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE auth_user_id = auth.uid();
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;
  IF v_role NOT IN ('super_admin','hq_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT jsonb_build_object(
    'success', true,
    'period', jsonb_build_object('month_start', v_m_start, 'month_end', v_m_end),
    -- 지점별 지표 (KPI 1~3,5~7)
    'branches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'branch_id',   b.id,
        'branch_name', b.name,
        -- KPI1 월매출: 이번달 시작된 이용권 가격 합계 (memberships.price, start_date 기준)
        'revenue_month', COALESCE((SELECT sum(price) FROM public.memberships
            WHERE branch_id = b.id AND start_date BETWEEN v_m_start AND v_m_end), 0),
        -- KPI2 활성 회원: members.status='active'
        'active_members', (SELECT count(*) FROM public.members
            WHERE branch_id = b.id AND status = 'active' AND deleted_at IS NULL),
        -- KPI3 신규 등록: 이번달 생성된 회원 (members.created_at)
        'new_members', (SELECT count(*) FROM public.members
            WHERE branch_id = b.id AND created_at::date BETWEEN v_m_start AND v_m_end),
        -- KPI5 만료 예정: 30일 내 만료되는 active 이용권
        'expiring_soon', (SELECT count(*) FROM public.memberships
            WHERE branch_id = b.id AND status = 'active'
              AND end_date BETWEEN v_today AND v_today + 30),
        -- KPI6 미납 회원: members.status='unpaid'
        'unpaid_members', (SELECT count(*) FROM public.members
            WHERE branch_id = b.id AND status = 'unpaid' AND deleted_at IS NULL),
        -- KPI7 14일 미출석: active 회원 중 최근 14일 출입성공 기록 없음
        'inactive_14d', (SELECT count(*) FROM public.members m
            WHERE m.branch_id = b.id AND m.status = 'active' AND m.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.access_logs al
                  WHERE al.member_id = m.id AND al.result = 'success'
                    AND al.occurred_at >= now() - interval '14 days'))
      ) ORDER BY b.name)
      FROM public.branches b WHERE b.deleted_at IS NULL
    ), '[]'::jsonb),
    -- KPI4 재등록률(%): 이번달 시작 이용권 중, 같은 회원의 더 이른 이용권이 있는 비율
    'renewal_rate', (
      SELECT CASE WHEN count(*) = 0 THEN 0
             ELSE round(100.0 * count(*) FILTER (WHERE prev_exists) / count(*), 1) END
      FROM (
        SELECT ms.id,
               EXISTS (SELECT 1 FROM public.memberships p
                       WHERE p.member_id = ms.member_id AND p.start_date < ms.start_date)
               AS prev_exists
        FROM public.memberships ms
        WHERE ms.start_date BETWEEN v_m_start AND v_m_end
      ) t),
    -- KPI8 설문 만족도 평균: survey_response_scores overall (최근 90일)
    'satisfaction_avg', (
      SELECT round(avg(s.score), 2) FROM public.survey_response_scores s
      JOIN public.survey_responses r ON r.id = s.response_id
      WHERE s.metric = 'overall' AND r.submitted_at >= now() - interval '90 days'),
    -- KPI9 불만 접수: 미해결(open) survey_alerts 건수
    'complaint_count', (SELECT count(*) FROM public.survey_alerts WHERE status = 'open'),
    -- KPI10 직원별 상담(업무) 처리율: tasks 완료/배정 비율
    'staff_processing', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'profile_id', p.id, 'name', p.name,
        'total', t.total, 'done', t.done,
        'rate', CASE WHEN t.total = 0 THEN 0 ELSE round(100.0 * t.done / t.total, 1) END)
        ORDER BY p.name)
      FROM (
        SELECT assigned_to,
               count(*) AS total,
               count(*) FILTER (WHERE status = 'done') AS done
        FROM public.tasks
        WHERE assigned_to IS NOT NULL AND deleted_at IS NULL
        GROUP BY assigned_to
      ) t
      JOIN public.profiles p ON p.id = t.assigned_to
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;

GRANT EXECUTE ON FUNCTION public.get_hq_kpi_dashboard() TO authenticated;

-- ── 지점장용 운영 KPI ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_branch_ops_dashboard(p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role   text;
  v_branch uuid;
  v_today  date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_result jsonb;
BEGIN
  SELECT role, branch_id INTO v_role, v_branch
  FROM public.profiles WHERE auth_user_id = auth.uid();
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  END IF;
  -- 권한: HQ는 임의 지점, 그 외는 자기 지점만
  IF v_role NOT IN ('super_admin','hq_admin') THEN
    IF p_branch_id IS NOT NULL AND p_branch_id <> v_branch THEN
      RETURN jsonb_build_object('success', false, 'error', 'FORBIDDEN');
    END IF;
    p_branch_id := v_branch;
  END IF;
  IF p_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'BRANCH_REQUIRED');
  END IF;

  SELECT jsonb_build_object(
    'success', true,
    'branch_id', p_branch_id,
    'base_date', v_today,
    -- KPI1 오늘 출석: 오늘 출입성공한 고유 회원 수
    'today_attendance', (
      SELECT count(DISTINCT member_id) FROM public.access_logs
      WHERE branch_id = p_branch_id AND result = 'success'
        AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date = v_today),
    -- KPI2 오늘 신규 상담: 오늘 작성된 상담노트
    'new_consultations_today', (
      SELECT count(*) FROM public.consultation_notes
      WHERE branch_id = p_branch_id AND created_at::date = v_today),
    -- KPI3 재등록 대상: 7일 내 만료되는 active 이용권 회원
    'renewal_targets', (
      SELECT count(*) FROM public.memberships
      WHERE branch_id = p_branch_id AND status = 'active'
        AND end_date BETWEEN v_today AND v_today + 7),
    -- KPI4 미납 관리 대상: status='unpaid' 회원
    'unpaid_targets', (
      SELECT count(*) FROM public.members
      WHERE branch_id = p_branch_id AND status = 'unpaid' AND deleted_at IS NULL),
    -- KPI5 오늘 완료할 task: open/in_progress 이면서 마감일이 오늘 이전
    'tasks_due', (
      SELECT count(*) FROM public.tasks
      WHERE branch_id = p_branch_id AND deleted_at IS NULL
        AND status IN ('open','in_progress')
        AND (due_date IS NULL OR due_date <= v_today)),
    -- KPI6 만족도 낮은 회원: 미해결 저점수/불만 알림 건수
    'low_satisfaction', (
      SELECT count(*) FROM public.survey_alerts
      WHERE branch_id = p_branch_id AND status = 'open'
        AND alert_type IN ('low_score','complaint_keyword')),
    -- KPI7 장기 미출석: active 회원 중 최근 14일 출입성공 없음
    'long_inactive', (
      SELECT count(*) FROM public.members m
      WHERE m.branch_id = p_branch_id AND m.status = 'active' AND m.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.access_logs al
            WHERE al.member_id = m.id AND al.result = 'success'
              AND al.occurred_at >= now() - interval '14 days'))
  ) INTO v_result;

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;

GRANT EXECUTE ON FUNCTION public.get_branch_ops_dashboard(uuid) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'KPI 대시보드 RPC 2종 완료';
END $$;

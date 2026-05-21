-- ============================================================
-- Fix: KPI 함수의 created_at 날짜 비교를 KST 기준으로 교정
-- ============================================================
-- get_hq_kpi_dashboard.new_members / get_branch_ops_dashboard.new_consultations_today
-- 가 created_at::date (서버 UTC) 로 계산해, 한국시간 00:00~09:00 등록 건이
-- 전날/전월로 잘못 집계되던 버그 → (created_at AT TIME ZONE 'Asia/Seoul')::date 로 교정.
-- ============================================================

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
    'branches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'branch_id',   b.id,
        'branch_name', b.name,
        'revenue_month', COALESCE((SELECT sum(price) FROM public.memberships
            WHERE branch_id = b.id AND start_date BETWEEN v_m_start AND v_m_end), 0),
        'active_members', (SELECT count(*) FROM public.members
            WHERE branch_id = b.id AND status = 'active' AND deleted_at IS NULL),
        'new_members', (SELECT count(*) FROM public.members
            WHERE branch_id = b.id
              AND (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN v_m_start AND v_m_end),
        'expiring_soon', (SELECT count(*) FROM public.memberships
            WHERE branch_id = b.id AND status = 'active'
              AND end_date BETWEEN v_today AND v_today + 30),
        'unpaid_members', (SELECT count(*) FROM public.members
            WHERE branch_id = b.id AND status = 'unpaid' AND deleted_at IS NULL),
        'inactive_14d', (SELECT count(*) FROM public.members m
            WHERE m.branch_id = b.id AND m.status = 'active' AND m.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.access_logs al
                  WHERE al.member_id = m.id AND al.result = 'success'
                    AND al.occurred_at >= now() - interval '14 days'))
      ) ORDER BY b.name)
      FROM public.branches b WHERE b.deleted_at IS NULL
    ), '[]'::jsonb),
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
    'satisfaction_avg', (
      SELECT round(avg(s.score), 2) FROM public.survey_response_scores s
      JOIN public.survey_responses r ON r.id = s.response_id
      WHERE s.metric = 'overall' AND r.submitted_at >= now() - interval '90 days'),
    'complaint_count', (SELECT count(*) FROM public.survey_alerts WHERE status = 'open'),
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
    'today_attendance', (
      SELECT count(DISTINCT member_id) FROM public.access_logs
      WHERE branch_id = p_branch_id AND result = 'success'
        AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date = v_today),
    'new_consultations_today', (
      SELECT count(*) FROM public.consultation_notes
      WHERE branch_id = p_branch_id
        AND (created_at AT TIME ZONE 'Asia/Seoul')::date = v_today),
    'renewal_targets', (
      SELECT count(*) FROM public.memberships
      WHERE branch_id = p_branch_id AND status = 'active'
        AND end_date BETWEEN v_today AND v_today + 7),
    'unpaid_targets', (
      SELECT count(*) FROM public.members
      WHERE branch_id = p_branch_id AND status = 'unpaid' AND deleted_at IS NULL),
    'tasks_due', (
      SELECT count(*) FROM public.tasks
      WHERE branch_id = p_branch_id AND deleted_at IS NULL
        AND status IN ('open','in_progress')
        AND (due_date IS NULL OR due_date <= v_today)),
    'low_satisfaction', (
      SELECT count(*) FROM public.survey_alerts
      WHERE branch_id = p_branch_id AND status = 'open'
        AND alert_type IN ('low_score','complaint_keyword')),
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

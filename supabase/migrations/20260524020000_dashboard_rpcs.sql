-- ============================================================
-- 3차: 대시보드 데이터 API (RPC)
-- ============================================================
-- get_branch_today_tasks : 지점장용 '오늘 할 일'
-- get_survey_dashboard   : 설문 결과/만족도 대시보드
-- 둘 다 SECURITY DEFINER + 호출자 권한 검증(HQ 전체 / 지점관리자 자기 지점).
-- ============================================================

-- ── 지점장용 오늘 할 일 ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_branch_today_tasks(p_branch_id uuid DEFAULT NULL)
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

  SELECT jsonb_build_object(
    'success', true,
    'base_date', v_today,
    'counts', jsonb_build_object(
      'open',        count(*) FILTER (WHERE status = 'open'),
      'in_progress', count(*) FILTER (WHERE status = 'in_progress'),
      'urgent',      count(*) FILTER (WHERE status IN ('open','in_progress') AND priority = 'urgent'),
      'due_today',   count(*) FILTER (WHERE status IN ('open','in_progress') AND due_date = v_today),
      'overdue',     count(*) FILTER (WHERE status IN ('open','in_progress') AND due_date < v_today)
    ),
    'by_type', COALESCE((
      SELECT jsonb_object_agg(task_type, c) FROM (
        SELECT task_type, count(*) c FROM public.tasks
        WHERE deleted_at IS NULL AND status IN ('open','in_progress')
          AND (p_branch_id IS NULL OR branch_id = p_branch_id)
        GROUP BY task_type
      ) t), '{}'::jsonb),
    'tasks', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY
               CASE x.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                               WHEN 'normal' THEN 2 ELSE 3 END,
               x.due_date NULLS LAST, x.created_at DESC)
      FROM (
        SELECT id, task_type, title, description, priority, status,
               due_date, member_id, assigned_to, created_at
        FROM public.tasks
        WHERE deleted_at IS NULL AND status IN ('open','in_progress')
          AND (p_branch_id IS NULL OR branch_id = p_branch_id)
        LIMIT 100
      ) x), '[]'::jsonb)
  ) INTO v_result
  FROM public.tasks
  WHERE deleted_at IS NULL
    AND (p_branch_id IS NULL OR branch_id = p_branch_id);

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;

GRANT EXECUTE ON FUNCTION public.get_branch_today_tasks(uuid) TO authenticated;

-- ── 설문 결과 대시보드 ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_survey_dashboard(
  p_branch_id uuid DEFAULT NULL,
  p_days      int  DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role   text;
  v_branch uuid;
  v_from   timestamptz;
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
  v_from := now() - make_interval(days => GREATEST(p_days, 1));

  SELECT jsonb_build_object(
    'success', true,
    'period_days', p_days,
    'response_count', (
      SELECT count(*) FROM public.survey_responses r
      WHERE r.submitted_at >= v_from
        AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)),
    'avg_overall', (
      SELECT round(avg(s.score), 2) FROM public.survey_response_scores s
      JOIN public.survey_responses r ON r.id = s.response_id
      WHERE s.metric = 'overall' AND r.submitted_at >= v_from
        AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)),
    'score_distribution', COALESCE((
      SELECT jsonb_object_agg(b, c) FROM (
        SELECT floor(s.score)::int AS b, count(*) c
        FROM public.survey_response_scores s
        JOIN public.survey_responses r ON r.id = s.response_id
        WHERE s.metric = 'overall' AND r.submitted_at >= v_from
          AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
        GROUP BY 1
      ) d), '{}'::jsonb),
    'open_alerts', (
      SELECT count(*) FROM public.survey_alerts a
      WHERE a.status = 'open'
        AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)),
    'alerts_by_type', COALESCE((
      SELECT jsonb_object_agg(alert_type, c) FROM (
        SELECT alert_type, count(*) c FROM public.survey_alerts
        WHERE status = 'open'
          AND (p_branch_id IS NULL OR branch_id = p_branch_id)
        GROUP BY 1
      ) t), '{}'::jsonb),
    'recent_alerts', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
        SELECT id, alert_type, severity, keyword, message, status, created_at
        FROM public.survey_alerts
        WHERE (p_branch_id IS NULL OR branch_id = p_branch_id)
        ORDER BY created_at DESC LIMIT 20
      ) x), '[]'::jsonb),
    'recent_comments', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.submitted_at DESC) FROM (
        SELECT r.id AS response_id, r.submitted_at, r.is_anonymous, a.answer_text
        FROM public.survey_answers a
        JOIN public.survey_responses r ON r.id = a.response_id
        JOIN public.survey_questions q ON q.id = a.question_id
        WHERE q.question_type = 'text' AND a.answer_text IS NOT NULL
          AND r.submitted_at >= v_from
          AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
        ORDER BY r.submitted_at DESC LIMIT 30
      ) x), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;

GRANT EXECUTE ON FUNCTION public.get_survey_dashboard(uuid, int) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE 'get_branch_today_tasks + get_survey_dashboard RPC 완료';
END $$;

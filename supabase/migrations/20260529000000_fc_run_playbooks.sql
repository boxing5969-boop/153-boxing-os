-- ============================================================
-- FC AI Care Center 2차-②: 플레이북 평가 엔진 + 일배치
-- ============================================================
-- run_playbooks(branch?) : 활성 playbook_rules 를 돌며
--   rule.trigger_segment 과 일치하는 오늘자 회원(member_segments=auto)에 대해
--   즉시 단계(delay_days=0, condition='{}') 를 실행한다.
--     - generate_message → message_suggestions(draft) 초안 생성 (절대 자동발송 안 함)
--     - create_task / notify_staff → tasks 업무카드 생성
-- fc_daily_run() : compute_member_snapshots() → run_playbooks() 순차 실행 래퍼.
-- 멱등성: 회원·규칙·단계·날짜 단위로 중복 생성 방지.
-- ============================================================

-- ── message_suggestions 에 플레이북 추적 컬럼 추가 (멱등 키 겸용) ──
ALTER TABLE public.message_suggestions
  ADD COLUMN IF NOT EXISTS playbook_rule_id uuid
    REFERENCES public.playbook_rules(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_msg_suggestions_playbook
  ON public.message_suggestions(playbook_rule_id, member_id, created_at DESC);

-- ── run_playbooks ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_playbooks(p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today  date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_day0   timestamptz := (v_today::timestamp AT TIME ZONE 'Asia/Seoul');
  v_rules  int := 0;
  v_msgs   int := 0;
  v_tasks  int := 0;
  r        record;
  s        record;
  mb       record;
  v_tmpl   public.message_templates%ROWTYPE;
  v_idem   text;
  v_title  text;
  v_ttype  text;
BEGIN
  FOR r IN
    SELECT * FROM public.playbook_rules
    WHERE is_active AND deleted_at IS NULL AND trigger_segment IS NOT NULL
  LOOP
    v_rules := v_rules + 1;

    FOR s IN
      SELECT * FROM public.playbook_steps
      WHERE playbook_rule_id = r.id
        AND delay_days = 0
        AND condition = '{}'::jsonb
        AND action_type IN ('generate_message','create_task','notify_staff')
      ORDER BY step_order
    LOOP
      FOR mb IN
        SELECT sn.member_id, sn.company_id, sn.brand_id, sn.branch_id
        FROM public.member_segments seg
        JOIN public.member_status_snapshots sn
          ON sn.member_id = seg.member_id AND sn.snapshot_date = v_today
        WHERE seg.segment_key = r.trigger_segment
          AND seg.source = 'auto'
          AND sn.company_id = r.company_id
          AND (r.brand_id  IS NULL OR sn.brand_id  = r.brand_id)
          AND (r.branch_id IS NULL OR sn.branch_id = r.branch_id)
          AND (p_branch_id IS NULL OR sn.branch_id = p_branch_id)
      LOOP
        BEGIN
          IF s.action_type = 'generate_message' THEN
            -- 멱등: 같은 규칙·회원·오늘 이미 초안 있으면 skip
            IF EXISTS (
              SELECT 1 FROM public.message_suggestions
              WHERE member_id = mb.member_id
                AND playbook_rule_id = r.id
                AND created_at >= v_day0
            ) THEN
              CONTINUE;
            END IF;

            -- 세그먼트 매칭 템플릿 (없으면 회사 활성 템플릿 중 최신)
            SELECT * INTO v_tmpl FROM public.message_templates
            WHERE deleted_at IS NULL AND is_active
              AND company_id = r.company_id
              AND (s.template_segment_key IS NULL
                   OR segment_key = s.template_segment_key)
            ORDER BY (segment_key IS NOT DISTINCT FROM s.template_segment_key) DESC,
                     updated_at DESC
            LIMIT 1;

            INSERT INTO public.message_suggestions
              (branch_id, member_id, template_id, channel, generated_body,
               generation_reason, status, playbook_rule_id)
            VALUES
              (mb.branch_id, mb.member_id, v_tmpl.id,
               COALESCE(v_tmpl.channel, 'kakao'),
               COALESCE(v_tmpl.content, ''),
               r.name || ' — ' || COALESCE(s.description, '자동 메시지 초안'),
               'draft', r.id);
            v_msgs := v_msgs + 1;

          ELSE
            -- create_task / notify_staff → 업무카드
            v_idem  := 'pb:' || r.id || ':' || s.id || ':'
                       || mb.member_id || ':' || v_today;
            v_ttype := COALESCE(s.task_type, 'other');
            v_title := COALESCE(s.description, r.name);

            INSERT INTO public.tasks
              (company_id, brand_id, branch_id, member_id, task_type, title,
               description, priority, status, due_date,
               source_table, source_id, idempotency_key,
               reason, recommended_action)
            VALUES
              (mb.company_id, mb.brand_id, mb.branch_id, mb.member_id,
               v_ttype, v_title, r.description, r.priority, 'open', v_today,
               'playbook_steps', s.id, v_idem,
               r.name || ' 플레이북 발동 (' || r.trigger_segment || ')',
               CASE s.action_type
                 WHEN 'notify_staff' THEN '담당 직원 확인 필요'
                 ELSE COALESCE(s.description, '회원 연락 진행') END)
            ON CONFLICT (idempotency_key)
              WHERE idempotency_key IS NOT NULL DO NOTHING;
            IF FOUND THEN v_tasks := v_tasks + 1; END IF;
          END IF;

        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'run_playbooks: rule % step % member % 실패 — %',
            r.id, s.id, mb.member_id, SQLERRM;
        END;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true, 'date', v_today,
    'rules', v_rules, 'messages_created', v_msgs, 'tasks_created', v_tasks);
END $$;

-- 데이터를 쓰는 배치 함수 — 익명(anon)·PUBLIC 실행 차단
REVOKE EXECUTE ON FUNCTION public.run_playbooks(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.run_playbooks(uuid) TO authenticated, service_role;

-- ── fc_daily_run : 분석 → 플레이북 순차 실행 래퍼 ────────────
CREATE OR REPLACE FUNCTION public.fc_daily_run()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_snap jsonb;
  v_pb   jsonb;
BEGIN
  v_snap := public.compute_member_snapshots();
  v_pb   := public.run_playbooks();
  RETURN jsonb_build_object(
    'success', true, 'ran_at', now(),
    'snapshots', v_snap, 'playbooks', v_pb);
END $$;

REVOKE EXECUTE ON FUNCTION public.fc_daily_run() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fc_daily_run() TO authenticated, service_role;

DO $$ BEGIN
  RAISE NOTICE 'FC 2차-②: run_playbooks + fc_daily_run 완료';
END $$;

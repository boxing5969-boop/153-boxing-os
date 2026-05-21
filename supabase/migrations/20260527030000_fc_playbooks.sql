-- ============================================================
-- FC AI Care Center 1차-④: 플레이북 (자동 업무 흐름)
-- ============================================================
-- playbook_rules : 상황별 발동 규칙 (조건 jsonb)
-- playbook_steps : 규칙별 단계 (메시지 생성 / task 생성 / 직원 알림 / 대기)
-- + 예시 플레이북 3종 시드
-- 실제 평가 엔진(run_playbooks)은 FC 2차에서 구현.
-- ============================================================

-- ── playbook_rules ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.playbook_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id        uuid REFERENCES public.brands(id)   ON DELETE CASCADE,
  branch_id       uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  trigger_segment text,
  conditions      jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority        text NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high','urgent')),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_playbook_rules_company
  ON public.playbook_rules(company_id, is_active) WHERE deleted_at IS NULL;

-- ── playbook_steps ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.playbook_steps (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_rule_id     uuid NOT NULL REFERENCES public.playbook_rules(id) ON DELETE CASCADE,
  step_order           int  NOT NULL,
  action_type          text NOT NULL CHECK (action_type IN
                         ('generate_message','create_task','notify_staff','wait')),
  task_type            text,
  delay_days           int NOT NULL DEFAULT 0,
  condition            jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_segment_key text,
  description          text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_step_order
  ON public.playbook_steps(playbook_rule_id, step_order);

CREATE OR REPLACE TRIGGER trg_playbook_rules_updated_at
  BEFORE UPDATE ON public.playbook_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.playbook_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playbook_steps ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.playbook_rules, public.playbook_steps TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.playbook_rules, public.playbook_steps TO authenticated;

-- playbook_rules: 같은 조직이면 조회, 쓰기는 조직 관리자
CREATE POLICY playbook_rules_read ON public.playbook_rules FOR SELECT TO authenticated
  USING (public.has_org_access(company_id));
CREATE POLICY playbook_rules_write ON public.playbook_rules FOR ALL TO authenticated
  USING (public.is_org_admin()) WITH CHECK (public.is_org_admin());

-- playbook_steps: 부모 규칙 접근권에 종속
CREATE POLICY playbook_steps_read ON public.playbook_steps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.playbook_rules r
                 WHERE r.id = playbook_steps.playbook_rule_id
                   AND public.has_org_access(r.company_id)));
CREATE POLICY playbook_steps_write ON public.playbook_steps FOR ALL TO authenticated
  USING (public.is_org_admin()) WITH CHECK (public.is_org_admin());

-- ── 예시 플레이북 3종 시드 ──────────────────────────────────
DO $$
DECLARE
  v_company uuid := (SELECT id FROM public.companies ORDER BY created_at LIMIT 1);
  v_rule    uuid;
BEGIN
  IF v_company IS NULL THEN RETURN; END IF;

  -- 플레이북 1: 15일 이상 미출석 복싱 회원
  IF NOT EXISTS (SELECT 1 FROM public.playbook_rules
                 WHERE company_id = v_company AND name = '15일 미출석 복싱 회원 복귀') THEN
    INSERT INTO public.playbook_rules (company_id, name, description, trigger_segment, conditions, priority)
    VALUES (v_company, '15일 미출석 복싱 회원 복귀',
            '15일 이상 출석하지 않은 활성 복싱 회원의 복귀를 유도', '15_days_absent',
            '{"product_type":"boxing","days_since_last_visit_gte":15,"membership_status":"active"}'::jsonb,
            'high')
    RETURNING id INTO v_rule;
    INSERT INTO public.playbook_steps (playbook_rule_id, step_order, action_type, task_type, delay_days, condition, template_segment_key, description) VALUES
      (v_rule, 1, 'generate_message', NULL, 0, '{}'::jsonb, 'winback_boxing', '복귀 유도 메시지 생성'),
      (v_rule, 2, 'create_task', 'no_show_recovery', 2, '{"no_reply":true}'::jsonb, NULL, '2일 내 답장 없으면 전화 task 생성'),
      (v_rule, 3, 'create_task', 'follow_up', 7, '{"no_visit":true}'::jsonb, NULL, '7일 내 출석 없으면 지점장 follow-up task'),
      (v_rule, 4, 'generate_message', NULL, 0, '{"re_attended":true}'::jsonb, 'praise_return', '복귀 출석 시 칭찬 메시지');
  END IF;

  -- 플레이북 2: 꾸준 출석 회원
  IF NOT EXISTS (SELECT 1 FROM public.playbook_rules
                 WHERE company_id = v_company AND name = '꾸준 출석 회원 보상') THEN
    INSERT INTO public.playbook_rules (company_id, name, description, trigger_segment, conditions, priority)
    VALUES (v_company, '꾸준 출석 회원 보상',
            '이번 달 10회 이상 출석·만족도 높은 회원에게 후기·추천 유도', 'consistent_attendee',
            '{"monthly_attendance_gte":10,"satisfaction_gte":4.5,"no_unpaid":true}'::jsonb,
            'normal')
    RETURNING id INTO v_rule;
    INSERT INTO public.playbook_steps (playbook_rule_id, step_order, action_type, task_type, delay_days, condition, template_segment_key, description) VALUES
      (v_rule, 1, 'generate_message', NULL, 0, '{}'::jsonb, 'praise_consistent', '칭찬 메시지 생성'),
      (v_rule, 2, 'create_task', 'referral', 3, '{}'::jsonb, NULL, '후기 요청 task'),
      (v_rule, 3, 'create_task', 'referral', 7, '{}'::jsonb, NULL, '지인 체험권 제안 task');
  END IF;

  -- 플레이북 3: PT 회차 소진 임박
  IF NOT EXISTS (SELECT 1 FROM public.playbook_rules
                 WHERE company_id = v_company AND name = 'PT 회차 소진 임박 재구매') THEN
    INSERT INTO public.playbook_rules (company_id, name, description, trigger_segment, conditions, priority)
    VALUES (v_company, 'PT 회차 소진 임박 재구매',
            'PT 잔여 3회 이하·최근 30일 4회 이상 출석 회원의 재구매 상담', 'pt_conversion_candidate',
            '{"pt_remaining_sessions_lte":3,"recent_30d_attendance_gte":4}'::jsonb,
            'high')
    RETURNING id INTO v_rule;
    INSERT INTO public.playbook_steps (playbook_rule_id, step_order, action_type, task_type, delay_days, condition, template_segment_key, description) VALUES
      (v_rule, 1, 'notify_staff', NULL, 0, '{}'::jsonb, NULL, '담당 트레이너 알림'),
      (v_rule, 2, 'generate_message', NULL, 0, '{}'::jsonb, 'pt_next_goal', '다음 목표 상담 메시지'),
      (v_rule, 3, 'create_task', 'pt_conversion', 1, '{}'::jsonb, NULL, 'PT 재구매 상담 task');
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'FC 1차-④: playbook_rules + playbook_steps + 예시 3종 완료';
END $$;

-- ============================================================
-- Phase 20F: CRM 8단계 파이프라인 (퍼널)
-- ============================================================
-- 전제: Phase 20A (claude/phase-20a-b2b-saas-db-foundation) 마이그레이션 적용됨
--       → is_tenant_member(uuid), has_tenant_role(uuid, text[]) 헬퍼 사용
--
-- 변경 사항:
--   1) members 확장: crm_stage, churn_reason, intensive_until, stage_changed_at
--   2) crm_stage_logs 신규 (append-only 이력)
--   3) move_member_stage() RPC — 단일 회원 stage 변경 + 로그 자동 적재
--   4) cron_advance_crm_stages() RPC — 매일 cron 에서 호출, 6 룰 자동 적용
--
-- 원칙:
--   - members.status 는 시스템 상태 (active/expired/withdrawn …) — 출입권한 자동화에 사용
--   - members.crm_stage 는 퍼널 UX 표시 (Stage 1~8) — 별도 의미
--   - 자동 cron 은 stage 만 이동, 메시지·access_grants 는 별도 시스템에 위임
-- ============================================================

-- ── members 확장 ────────────────────────────────────────────
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS crm_stage        text NOT NULL DEFAULT 'stage_1',
  ADD COLUMN IF NOT EXISTS churn_reason     text,
  ADD COLUMN IF NOT EXISTS intensive_until  timestamptz,
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_crm_stage_check') THEN
    ALTER TABLE public.members ADD CONSTRAINT members_crm_stage_check
      CHECK (crm_stage IN (
        'stage_1','stage_2','stage_3','stage_4',
        'stage_5_intensive','stage_5_normal',
        'stage_6','stage_7','stage_8'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'members_churn_reason_check') THEN
    ALTER TABLE public.members ADD CONSTRAINT members_churn_reason_check
      CHECK (churn_reason IS NULL OR churn_reason IN (
        'trial_not_purchased','trial_dropped','membership_expired'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_members_crm_stage
  ON public.members(company_id, crm_stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_members_intensive_until
  ON public.members(intensive_until) WHERE intensive_until IS NOT NULL;

-- ── crm_stage_logs (append-only) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_stage_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  member_id    uuid        NOT NULL REFERENCES public.members(id)   ON DELETE CASCADE,
  from_stage   text,
  to_stage     text        NOT NULL,
  reason       text,
  source       text        NOT NULL DEFAULT 'manual'
               CHECK (source IN ('manual','cron_d3','cron_d14','cron_14d','cron_7d','cron_expired','cron_trial_dropped')),
  changed_by   uuid,        -- auth.users.id (FK 미연결 — 계정 삭제돼도 로그 보존)
  changed_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_stage_logs_member ON public.crm_stage_logs(member_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_stage_logs_tenant ON public.crm_stage_logs(tenant_id, changed_at DESC);

-- append-only — UPDATE/DELETE 차단
DROP TRIGGER IF EXISTS trg_crm_stage_logs_append_only ON public.crm_stage_logs;
CREATE TRIGGER trg_crm_stage_logs_append_only
  BEFORE UPDATE OR DELETE ON public.crm_stage_logs
  FOR EACH ROW EXECUTE FUNCTION public.block_modify();

-- RLS
ALTER TABLE public.crm_stage_logs ENABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.crm_stage_logs TO service_role;
GRANT SELECT ON public.crm_stage_logs TO authenticated;

DROP POLICY IF EXISTS crm_stage_logs_select ON public.crm_stage_logs;
CREATE POLICY crm_stage_logs_select ON public.crm_stage_logs
  FOR SELECT TO authenticated
  USING (is_tenant_member(tenant_id));

-- ============================================================
-- RPC: move_member_stage — 단일 회원 stage 변경 + 로그 적재 (멱등)
-- ============================================================
CREATE OR REPLACE FUNCTION public.move_member_stage(
  p_member_id uuid,
  p_to_stage  text,
  p_reason    text DEFAULT NULL,
  p_source    text DEFAULT 'manual'
)
RETURNS public.crm_stage_logs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member  public.members%ROWTYPE;
  v_from    text;
  v_log     public.crm_stage_logs%ROWTYPE;
BEGIN
  -- 권한: 해당 회원의 tenant 안에 owner/manager/branch staff/coach 권한이 있어야
  SELECT * INTO v_member FROM public.members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found: %', p_member_id USING ERRCODE = 'P0002';
  END IF;

  -- 인증 사용자 권한 확인 (service_role 호출 시 auth.uid() NULL — cron 경로는 권한 검증 skip)
  IF auth.uid() IS NOT NULL AND NOT (
    is_hq_admin()
    OR (is_branch_admin() AND v_member.branch_id = current_branch_id())
    OR has_tenant_role(v_member.company_id, ARRAY['owner','hq_admin','super_admin','branch_owner','branch_manager','staff','coach'])
  ) THEN
    RAISE EXCEPTION 'forbidden: no permission to move member stage' USING ERRCODE = '42501';
  END IF;

  v_from := v_member.crm_stage;

  -- 멱등: 이미 같은 stage 면 no-op (로그도 안 남김 — cron 매일 호출 대응)
  IF v_from = p_to_stage THEN
    RETURN NULL;
  END IF;

  -- stage 이동
  UPDATE public.members
  SET crm_stage = p_to_stage,
      stage_changed_at = now(),
      -- Stage 5_intensive 진입 시 intensive_until 자동 세팅 (14일 후)
      intensive_until = CASE
        WHEN p_to_stage = 'stage_5_intensive' THEN now() + interval '14 days'
        WHEN p_to_stage = 'stage_5_normal'    THEN NULL
        ELSE intensive_until
      END,
      -- Stage 7 churn_reason 은 reason 인자 그대로 사용 (자동 매핑)
      churn_reason = CASE
        WHEN p_to_stage = 'stage_7' AND p_reason IN ('trial_not_purchased','trial_dropped','membership_expired')
          THEN p_reason
        WHEN p_to_stage <> 'stage_7' THEN NULL
        ELSE churn_reason
      END,
      updated_at = now()
  WHERE id = p_member_id;

  -- 로그 적재
  INSERT INTO public.crm_stage_logs
    (tenant_id, member_id, from_stage, to_stage, reason, source, changed_by)
  VALUES
    (v_member.company_id, p_member_id, v_from, p_to_stage, p_reason, p_source, auth.uid())
  RETURNING * INTO v_log;

  RETURN v_log;
END $$;

REVOKE ALL ON FUNCTION public.move_member_stage(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_member_stage(uuid, text, text, text) TO authenticated, service_role;

-- ============================================================
-- RPC: cron_advance_crm_stages — 매일 1회 cron 에서 호출
-- ============================================================
-- 6 룰:
--   R1: 체험권 만료 D-3 → stage_4         (stage_2/stage_3 에서만 이동)
--   R2: 회원권 만료 D-14 → stage_6        (stage_5_* 에서만)
--   R3: 신규회원 14일 경과 → stage_5_normal (stage_5_intensive 만)
--   R4: 7일 미출석 → stage_8              (stage_5_* 에서만)
--   R5: 회원권 만료 → stage_7 / 'membership_expired'
--   R6: 체험권 만료 후 회원권 미가입 → stage_7 / 'trial_dropped'
--
-- 멱등: move_member_stage 가 같은 stage 면 no-op
-- ============================================================
CREATE OR REPLACE FUNCTION public.cron_advance_crm_stages()
RETURNS TABLE(rule text, member_id uuid, from_stage text, to_stage text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  -- R1: 체험권 D-3
  FOR r IN
    SELECT DISTINCT m.id, m.crm_stage
    FROM public.members m
    JOIN public.trial_passes tp ON tp.member_id = m.id
    WHERE m.deleted_at IS NULL
      AND m.crm_stage IN ('stage_2','stage_3')
      AND tp.status = 'active'
      AND tp.end_at::date = v_today + 3
  LOOP
    PERFORM public.move_member_stage(r.id, 'stage_4', 'trial_d3_auto', 'cron_d3');
    rule := 'R1_d3'; member_id := r.id; from_stage := r.crm_stage; to_stage := 'stage_4'; RETURN NEXT;
  END LOOP;

  -- R2: 회원권 D-14
  FOR r IN
    SELECT DISTINCT m.id, m.crm_stage
    FROM public.members m
    JOIN public.memberships ms ON ms.member_id = m.id
    WHERE m.deleted_at IS NULL
      AND m.crm_stage IN ('stage_5_intensive','stage_5_normal')
      AND ms.status = 'active'
      AND ms.end_date::date = v_today + 14
  LOOP
    PERFORM public.move_member_stage(r.id, 'stage_6', 'membership_d14_auto', 'cron_d14');
    rule := 'R2_d14'; member_id := r.id; from_stage := r.crm_stage; to_stage := 'stage_6'; RETURN NEXT;
  END LOOP;

  -- R3: 신규회원 14일 경과 → intensive→normal
  FOR r IN
    SELECT id, crm_stage FROM public.members
    WHERE deleted_at IS NULL
      AND crm_stage = 'stage_5_intensive'
      AND intensive_until IS NOT NULL
      AND intensive_until < now()
  LOOP
    PERFORM public.move_member_stage(r.id, 'stage_5_normal', 'intensive_period_ended', 'cron_14d');
    rule := 'R3_14d'; member_id := r.id; from_stage := r.crm_stage; to_stage := 'stage_5_normal'; RETURN NEXT;
  END LOOP;

  -- R4: 7일 미출석 → stage_8 (활성 회원권 보유 + 마지막 출입 7일 이상)
  FOR r IN
    SELECT m.id, m.crm_stage
    FROM public.members m
    WHERE m.deleted_at IS NULL
      AND m.crm_stage IN ('stage_5_intensive','stage_5_normal')
      AND NOT EXISTS (
        SELECT 1 FROM public.access_logs al
        WHERE al.member_id = m.id
          AND al.result = 'success'
          AND al.occurred_at >= now() - interval '7 days'
      )
      AND EXISTS (
        SELECT 1 FROM public.memberships ms
        WHERE ms.member_id = m.id AND ms.status = 'active' AND ms.end_date::date >= v_today
      )
  LOOP
    PERFORM public.move_member_stage(r.id, 'stage_8', '7d_no_attendance', 'cron_7d');
    rule := 'R4_7d'; member_id := r.id; from_stage := r.crm_stage; to_stage := 'stage_8'; RETURN NEXT;
  END LOOP;

  -- R5: 회원권 만료 → stage_7 / membership_expired
  FOR r IN
    SELECT DISTINCT m.id, m.crm_stage
    FROM public.members m
    WHERE m.deleted_at IS NULL
      AND m.crm_stage IN ('stage_5_intensive','stage_5_normal','stage_6','stage_8')
      AND NOT EXISTS (
        SELECT 1 FROM public.memberships ms2
        WHERE ms2.member_id = m.id AND ms2.status = 'active' AND ms2.end_date::date >= v_today
      )
  LOOP
    PERFORM public.move_member_stage(r.id, 'stage_7', 'membership_expired', 'cron_expired');
    rule := 'R5_expired'; member_id := r.id; from_stage := r.crm_stage; to_stage := 'stage_7'; RETURN NEXT;
  END LOOP;

  -- R6: 체험권 만료 후 회원권 미가입 → stage_7 / trial_dropped
  FOR r IN
    SELECT DISTINCT m.id, m.crm_stage
    FROM public.members m
    WHERE m.deleted_at IS NULL
      AND m.crm_stage = 'stage_4'
      AND NOT EXISTS (
        SELECT 1 FROM public.trial_passes tp
        WHERE tp.member_id = m.id AND tp.status = 'active' AND tp.end_at::date >= v_today
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.memberships ms3
        WHERE ms3.member_id = m.id AND ms3.status = 'active'
      )
  LOOP
    PERFORM public.move_member_stage(r.id, 'stage_7', 'trial_dropped', 'cron_trial_dropped');
    rule := 'R6_trial_dropped'; member_id := r.id; from_stage := r.crm_stage; to_stage := 'stage_7'; RETURN NEXT;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.cron_advance_crm_stages() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_advance_crm_stages() TO service_role;

DO $$ BEGIN
  RAISE NOTICE 'Phase 20F: CRM pipeline 8 stages + move_member_stage + cron_advance_crm_stages 완료';
END $$;

-- ============================================================
-- 2차: 메시지 큐 — 알림톡/SMS는 즉시 발송 대신 message_jobs 적재
-- ============================================================
-- message_jobs : 발송 대기 큐 (워커가 소비 — provider 연동은 다음 단계)
-- message_logs : 발송 시도별 결과 로그 (append-only)
-- enqueue_message_job() : 큐 적재 헬퍼 (멱등 처리 포함)
-- 기존 scheduled_messages/message_send_logs 와 병행 — 기존 알림 기능 영향 없음.
-- ============================================================

-- ── message_jobs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id        uuid REFERENCES public.brands(id)   ON DELETE SET NULL,
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_id       uuid REFERENCES public.members(id)  ON DELETE SET NULL,
  template_code   text,
  channel         text NOT NULL CHECK (channel IN ('kakao','sms','email','push')),
  scheduled_at    timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','sent','failed','retry','cancelled')),
  retry_count     int  NOT NULL DEFAULT 0,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipient_phone text,
  error_message   text,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
-- 워커가 처리 대기 작업을 빠르게 찾기 위한 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_message_jobs_due
  ON public.message_jobs(scheduled_at)
  WHERE status IN ('pending','retry');
CREATE INDEX IF NOT EXISTS idx_message_jobs_branch
  ON public.message_jobs(branch_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_jobs_idem
  ON public.message_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ── message_logs (append-only) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_job_id      uuid NOT NULL REFERENCES public.message_jobs(id) ON DELETE CASCADE,
  provider            text,
  provider_message_id text,
  result_code         text,
  result_message      text,
  sent_at             timestamptz,
  failed_reason       text,
  raw_response        jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_logs_job ON public.message_logs(message_job_id, created_at DESC);

-- ── 트리거 ──────────────────────────────────────────────────
CREATE OR REPLACE TRIGGER trg_message_jobs_fill BEFORE INSERT ON public.message_jobs
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();
CREATE OR REPLACE TRIGGER trg_message_jobs_updated_at BEFORE UPDATE ON public.message_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_message_logs_append_only
  BEFORE UPDATE OR DELETE ON public.message_logs
  FOR EACH ROW EXECUTE FUNCTION public.block_modify();

-- ── enqueue_message_job: 큐 적재 헬퍼 (멱등) ────────────────
CREATE OR REPLACE FUNCTION public.enqueue_message_job(
  p_branch_id       uuid,
  p_channel         text,
  p_template_code   text         DEFAULT NULL,
  p_member_id       uuid         DEFAULT NULL,
  p_payload         jsonb        DEFAULT '{}'::jsonb,
  p_scheduled_at    timestamptz  DEFAULT now(),
  p_recipient_phone text         DEFAULT NULL,
  p_idempotency_key text         DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  -- 멱등: 같은 키가 이미 있으면 새로 만들지 않고 기존 작업 반환
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.message_jobs WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  INSERT INTO public.message_jobs
    (branch_id, channel, template_code, member_id, payload,
     scheduled_at, recipient_phone, idempotency_key)
  VALUES
    (p_branch_id, p_channel, p_template_code, p_member_id, p_payload,
     p_scheduled_at, p_recipient_phone, p_idempotency_key)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.enqueue_message_job(uuid,text,text,uuid,jsonb,timestamptz,text,text)
  TO authenticated, service_role;

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.message_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.message_jobs, public.message_logs TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.message_jobs TO authenticated;
GRANT SELECT ON public.message_logs TO authenticated;

CREATE POLICY message_jobs_hq  ON public.message_jobs FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY message_jobs_brc ON public.message_jobs FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());

-- message_logs: branch_id 없음 → message_jobs 통해 지점 제한
CREATE POLICY message_logs_select ON public.message_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.message_jobs j
      WHERE j.id = message_logs.message_job_id
        AND (is_hq_admin() OR (is_branch_admin() AND j.branch_id = current_branch_id()))
    )
  );

DO $$ BEGIN
  RAISE NOTICE 'message_jobs + message_logs + enqueue_message_job 완료';
END $$;

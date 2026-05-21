-- ============================================================
-- Phase B 후속 2단계: accountant 결제 한정 제약
-- ============================================================
-- accountant 전용 사용자(운영 역할 없이 accountant 역할만 가진 사람)는
-- 결제/정산 테이블만 접근하고, 회원 PII·설문·업무 등 비재무 테이블에는
-- 접근하지 못하도록 B-3 의 pb 정책을 정밀화한다.
--
-- 결제/정산 테이블(accountant 접근 허용 — 그대로 둠):
--   payment_requests, payment_events, invoices, refunds,
--   ledger_entries, branch_expenses, memberships(미납 관리)
-- 비재무 테이블(accountant 전용 사용자 제외):
--   members, message_jobs, tasks, survey_alerts, survey_templates,
--   survey_qr_codes, visitor_requests, consultation_notes,
--   access_logs, survey_responses, survey_response_scores, survey_invitations
--
-- ※ B-3 에서 만든 pb 정책만 재정의한다. Phase B 이전의 기존 정책은
--   건드리지 않으므로 슈퍼관리자·지점 계정 동작은 보존된다.
-- ============================================================

-- ── accountant 전용 사용자 판별 헬퍼 ────────────────────────
CREATE OR REPLACE FUNCTION public.is_accountant_only()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_accountant()
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.auth_user_id = auth.uid()
         AND p.role IN ('super_admin','hq_admin','owner',
                        'branch_owner','branch_manager','staff','coach')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.staff_roles sr
       JOIN public.profiles p ON p.id = sr.profile_id
       WHERE p.auth_user_id = auth.uid() AND sr.status = 'active'
         AND sr.role IN ('super_admin','hq_admin','owner',
                         'branch_owner','branch_manager','staff','coach')
     );
$$;
GRANT EXECUTE ON FUNCTION public.is_accountant_only() TO authenticated;

-- ── 비재무 read+write 테이블: accountant 전용 제외 ──────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'members','message_jobs','tasks','survey_alerts','survey_templates',
    'survey_qr_codes','visitor_requests','consultation_notes'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_pb_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_pb_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (public.has_branch_access(branch_id) AND NOT public.is_accountant_only())',
      t||'_pb_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.has_branch_access(branch_id) '
      '       AND NOT public.is_viewer_only() AND NOT public.is_accountant_only()) '
      'WITH CHECK (public.has_branch_access(branch_id) '
      '       AND NOT public.is_viewer_only() AND NOT public.is_accountant_only())',
      t||'_pb_write', t);
  END LOOP;
END $$;

-- ── 비재무 read-only 테이블: accountant 전용 제외 ───────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'access_logs','survey_responses','survey_response_scores','survey_invitations'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_pb_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (public.has_branch_access(branch_id) AND NOT public.is_accountant_only())',
      t||'_pb_read', t);
  END LOOP;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Phase B 2단계: accountant 결제 한정 제약 완료';
END $$;

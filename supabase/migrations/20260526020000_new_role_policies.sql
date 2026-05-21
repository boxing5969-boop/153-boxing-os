-- ============================================================
-- Phase B-3: 신규 역할용 RLS 정책 추가 (추가형)
-- ============================================================
-- 기존 정책은 그대로 둔다. permissive 정책은 OR 결합이므로
-- 새 정책을 더하면 접근이 늘기만 하고 줄지 않는다 → 현행 동작 100% 보존.
-- 신규 정책은 staff_roles 기반 헬퍼(has_branch_access / has_org_access)를
-- 사용하므로 owner / brand_manager / 다중지점 staff / accountant / viewer 가
-- 작동하게 된다. (현재 그 역할 보유자가 없으므로 적용 즉시 영향 0)
--
-- 정책 명명: <table>_pb_read (조회) / <table>_pb_write (쓰기, viewer 제외)
-- ============================================================

-- ── viewer 전용(쓰기 불가) 판별 헬퍼 ────────────────────────
CREATE OR REPLACE FUNCTION public.is_viewer_only()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- 쓰기 가능 역할이 하나도 없으면 viewer 전용으로 간주
  SELECT NOT (
    EXISTS (SELECT 1 FROM public.profiles p
            WHERE p.auth_user_id = auth.uid()
              AND p.role NOT IN ('viewer','member'))
    OR EXISTS (SELECT 1 FROM public.staff_roles sr
               JOIN public.profiles p ON p.id = sr.profile_id
               WHERE p.auth_user_id = auth.uid() AND sr.status = 'active'
                 AND sr.role NOT IN ('viewer','member'))
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_viewer_only() TO authenticated;

-- ── 지점 단위: 조회 + 쓰기 (members 등) ─────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'members','memberships','payment_requests','invoices','refunds',
    'message_jobs','tasks','survey_alerts','survey_templates',
    'survey_qr_codes','visitor_requests','consultation_notes','branch_expenses'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (public.has_branch_access(branch_id))', t||'_pb_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.has_branch_access(branch_id) AND NOT public.is_viewer_only()) '
      'WITH CHECK (public.has_branch_access(branch_id) AND NOT public.is_viewer_only())',
      t||'_pb_write', t);
  END LOOP;
END $$;

-- ── 지점 단위: 조회 전용 (append-only / RPC 적재 테이블) ────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'access_logs','payment_events','ledger_entries',
    'survey_responses','survey_response_scores','survey_invitations'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (public.has_branch_access(branch_id))', t||'_pb_read', t);
  END LOOP;
END $$;

-- ── 조직 단위: brands / staff_roles ─────────────────────────
CREATE POLICY brands_pb_read ON public.brands FOR SELECT TO authenticated
  USING (public.has_org_access(company_id));
CREATE POLICY brands_pb_write ON public.brands FOR ALL TO authenticated
  USING (public.is_org_admin()) WITH CHECK (public.is_org_admin());

CREATE POLICY staff_roles_pb_read ON public.staff_roles FOR SELECT TO authenticated
  USING (public.has_org_access(company_id));
CREATE POLICY staff_roles_pb_write ON public.staff_roles FOR ALL TO authenticated
  USING (public.is_org_admin()) WITH CHECK (public.is_org_admin());

DO $$ BEGIN
  RAISE NOTICE 'Phase B-3: 신규 역할 정책 추가 완료 (기존 정책 미변경)';
END $$;

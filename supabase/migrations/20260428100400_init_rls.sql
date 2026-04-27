-- Phase 3 마이그레이션 5/6: Row Level Security 정책
-- 참조: docs/01-db-schema.md §5
-- 원칙:
--   - hq (super_admin/hq_admin): 전 영역
--   - branch_admin (branch_owner/branch_manager): 자기 지점
--   - coach: 담당 회원
--   - access_logs: SELECT 만 RLS, INSERT 는 service_role 전용, UPDATE/DELETE 는 트리거로 차단

-- ===== companies =====
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY companies_select_all ON companies
  FOR SELECT TO authenticated USING (true);
CREATE POLICY companies_hq_write ON companies
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());

-- ===== branches =====
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY branches_select_all ON branches
  FOR SELECT TO authenticated USING (true);
CREATE POLICY branches_hq_write ON branches
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());

-- ===== profiles =====
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_self_select ON profiles
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());
CREATE POLICY profiles_hq_all ON profiles
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY profiles_branch_select ON profiles
  FOR SELECT TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id());

-- ===== members =====
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
CREATE POLICY members_hq_all ON members
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY members_branch_all ON members
  FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());
CREATE POLICY members_coach_select ON members
  FOR SELECT TO authenticated
  USING (has_role('coach') AND is_coach_of(id));

-- ===== memberships =====
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_hq_all ON memberships
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY memberships_branch_all ON memberships
  FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());

-- ===== trial_passes =====
ALTER TABLE trial_passes ENABLE ROW LEVEL SECURITY;
CREATE POLICY trial_passes_hq_all ON trial_passes
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY trial_passes_branch_all ON trial_passes
  FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());

-- ===== access_devices =====
ALTER TABLE access_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY devices_hq_all ON access_devices
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY devices_branch_all ON access_devices
  FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());

-- ===== device_users =====
ALTER TABLE device_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_users_hq_all ON device_users
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY device_users_branch_all ON device_users
  FOR ALL TO authenticated
  USING (
    is_branch_admin() AND EXISTS (
      SELECT 1 FROM access_devices d
      WHERE d.id = device_users.device_id AND d.branch_id = current_branch_id()
    )
  )
  WITH CHECK (
    is_branch_admin() AND EXISTS (
      SELECT 1 FROM access_devices d
      WHERE d.id = device_users.device_id AND d.branch_id = current_branch_id()
    )
  );

-- ===== access_grants =====
ALTER TABLE access_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY grants_hq_all ON access_grants
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY grants_branch_all ON access_grants
  FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());

-- ===== access_logs (SELECT 만 권한 분배 — INSERT 는 service_role) =====
ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY logs_hq_select ON access_logs
  FOR SELECT TO authenticated
  USING (is_hq_admin());
CREATE POLICY logs_branch_select ON access_logs
  FOR SELECT TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id());
CREATE POLICY logs_coach_select ON access_logs
  FOR SELECT TO authenticated
  USING (has_role('coach') AND member_id IS NOT NULL AND is_coach_of(member_id));

-- ===== device_sync_jobs =====
ALTER TABLE device_sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_jobs_hq_all ON device_sync_jobs
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY sync_jobs_branch_select ON device_sync_jobs
  FOR SELECT TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id());

-- ===== visitor_requests =====
ALTER TABLE visitor_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY visitors_hq_all ON visitor_requests
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY visitors_branch_all ON visitor_requests
  FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());

-- ===== consent_records =====
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_hq_all ON consent_records
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY consent_branch_all ON consent_records
  FOR ALL TO authenticated
  USING (is_branch_admin() AND is_branch_member_of(member_id))
  WITH CHECK (is_branch_admin() AND is_branch_member_of(member_id));

-- ===== level_progress =====
ALTER TABLE level_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY level_hq_all ON level_progress
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY level_branch_all ON level_progress
  FOR ALL TO authenticated
  USING (is_branch_admin() AND is_branch_member_of(member_id))
  WITH CHECK (is_branch_admin() AND is_branch_member_of(member_id));
CREATE POLICY level_coach_all ON level_progress
  FOR ALL TO authenticated
  USING (has_role('coach') AND is_coach_of(member_id))
  WITH CHECK (has_role('coach') AND is_coach_of(member_id));

-- ===== consultation_notes =====
ALTER TABLE consultation_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY consults_hq_all ON consultation_notes
  FOR ALL TO authenticated
  USING (is_hq_admin()) WITH CHECK (is_hq_admin());
CREATE POLICY consults_branch_all ON consultation_notes
  FOR ALL TO authenticated
  USING (is_branch_admin() AND branch_id = current_branch_id())
  WITH CHECK (is_branch_admin() AND branch_id = current_branch_id());
CREATE POLICY consults_coach_all ON consultation_notes
  FOR ALL TO authenticated
  USING (has_role('coach') AND is_coach_of(member_id))
  WITH CHECK (has_role('coach') AND is_coach_of(member_id));

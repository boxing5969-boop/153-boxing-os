-- Phase 3 마이그레이션 3/6: 인덱스
-- 참조: docs/01-db-schema.md §6

CREATE INDEX idx_branches_company       ON branches(company_id);
CREATE INDEX idx_profiles_auth          ON profiles(auth_user_id);
CREATE INDEX idx_profiles_branch        ON profiles(branch_id);
CREATE INDEX idx_members_branch         ON members(branch_id);
CREATE INDEX idx_members_status         ON members(branch_id, status);
CREATE INDEX idx_members_coach          ON members(assigned_coach_id);
CREATE INDEX idx_members_phone          ON members(phone);
CREATE INDEX idx_memberships_member     ON memberships(member_id);
CREATE INDEX idx_memberships_active     ON memberships(member_id, status, end_date);
CREATE INDEX idx_trials_member          ON trial_passes(member_id, status);
CREATE INDEX idx_devices_branch         ON access_devices(branch_id);
CREATE UNIQUE INDEX idx_devices_identifier ON access_devices(vendor, device_identifier);
CREATE INDEX idx_device_users_member    ON device_users(member_id);
CREATE INDEX idx_grants_member_active   ON access_grants(member_id, status, valid_until);
CREATE INDEX idx_logs_branch_time       ON access_logs(branch_id, occurred_at DESC);
CREATE INDEX idx_logs_member_time       ON access_logs(member_id, occurred_at DESC);
CREATE INDEX idx_logs_denied            ON access_logs(branch_id, result, denied_reason)
  WHERE result = 'denied';
CREATE INDEX idx_sync_pending           ON device_sync_jobs(status, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX idx_consents_member        ON consent_records(member_id, consent_type);
CREATE INDEX idx_consultations_member   ON consultation_notes(member_id, created_at DESC);

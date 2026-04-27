-- Phase 3 마이그레이션 1/6: ENUM 정의
-- 참조: docs/01-db-schema.md §2

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE member_status AS ENUM (
  'active', 'trial', 'expired', 'suspended', 'unpaid', 'withdrawn'
);

CREATE TYPE payment_status AS ENUM ('paid', 'unpaid', 'partial', 'refunded');
CREATE TYPE membership_status AS ENUM ('active', 'expired', 'paused', 'canceled');
CREATE TYPE trial_pass_status AS ENUM ('active', 'used', 'expired', 'canceled');

CREATE TYPE user_role AS ENUM (
  'super_admin', 'hq_admin', 'branch_owner', 'branch_manager', 'coach', 'member'
);

CREATE TYPE credential_type AS ENUM ('face', 'qr', 'card', 'pin', 'admin', 'visitor');
CREATE TYPE access_result AS ENUM ('success', 'denied', 'error');

CREATE TYPE denied_reason AS ENUM (
  'expired_membership', 'unpaid', 'suspended', 'no_valid_grant',
  'trial_expired', 'trial_max_used',
  'qr_expired', 'qr_already_used', 'qr_invalid_signature',
  'device_error', 'unknown_user', 'outside_allowed_time', 'consent_revoked'
);

CREATE TYPE device_type AS ENUM ('face_terminal', 'qr_reader', 'card_reader', 'relay', 'kiosk');
CREATE TYPE device_vendor AS ENUM ('suprema', 'zkteco', 'hikvision', 'mock', 'custom', 'other');
CREATE TYPE device_status AS ENUM ('active', 'inactive', 'error');

CREATE TYPE grant_type AS ENUM ('membership', 'trial', 'staff', 'admin_override');
CREATE TYPE grant_status AS ENUM ('active', 'expired', 'revoked', 'suspended');

CREATE TYPE sync_job_type AS ENUM (
  'create_user', 'update_user', 'disable_user', 'delete_user',
  'sync_access_group', 'pull_logs'
);
CREATE TYPE sync_job_status AS ENUM ('pending', 'processing', 'success', 'failed');

CREATE TYPE visit_purpose AS ENUM ('consultation', 'tour', 'trial', 'registration');
CREATE TYPE visitor_request_status AS ENUM ('requested', 'approved', 'denied', 'completed');

CREATE TYPE consent_type AS ENUM ('face_recognition', 'privacy', 'marketing', 'terms');

CREATE TYPE level_tier AS ENUM ('white', 'blue', 'red', 'black');
CREATE TYPE level_status AS ENUM ('not_started', 'in_progress', 'passed', 'failed');

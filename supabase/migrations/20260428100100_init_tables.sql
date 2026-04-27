-- Phase 3 마이그레이션 2/6: 14개 테이블 정의
-- 참조: docs/01-db-schema.md §3

-- 3.1 companies (본사)
CREATE TABLE companies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  business_type text DEFAULT 'franchise',
  created_at    timestamptz DEFAULT now()
);

-- 3.2 branches (지점)
CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  address     text,
  phone       text,
  status      text DEFAULT 'active',
  created_at  timestamptz DEFAULT now()
);

-- 3.3 profiles (직원/관리자/코치)
CREATE TABLE profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role          user_role NOT NULL,
  company_id    uuid REFERENCES companies(id) ON DELETE SET NULL,
  branch_id     uuid REFERENCES branches(id) ON DELETE SET NULL,
  name          text NOT NULL,
  phone         text,
  status        text DEFAULT 'active',
  created_at    timestamptz DEFAULT now()
);

-- 3.4 members (회원)
CREATE TABLE members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  branch_id           uuid NOT NULL REFERENCES branches(id),
  name                text NOT NULL,
  phone               text,
  birth_date          date,
  gender              text,
  status              member_status NOT NULL DEFAULT 'trial',
  assigned_coach_id   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ranking_app_user_id uuid,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- 3.5 memberships (이용권)
CREATE TABLE memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES branches(id),
  plan_name       text NOT NULL,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  payment_status  payment_status NOT NULL DEFAULT 'paid',
  status          membership_status NOT NULL DEFAULT 'active',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT memberships_date_order CHECK (end_date >= start_date)
);

-- 3.6 trial_passes (체험권)
CREATE TABLE trial_passes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL REFERENCES branches(id),
  start_at      timestamptz NOT NULL,
  end_at        timestamptz NOT NULL,
  max_entries   int NOT NULL DEFAULT 1,
  used_entries  int NOT NULL DEFAULT 0,
  status        trial_pass_status NOT NULL DEFAULT 'active',
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT trial_passes_used_range CHECK (used_entries >= 0 AND used_entries <= max_entries)
);

-- 3.7 access_devices (출입장비)
CREATE TABLE access_devices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         uuid NOT NULL REFERENCES branches(id),
  device_name       text NOT NULL,
  device_type       device_type NOT NULL,
  vendor            device_vendor NOT NULL,
  model_name        text,
  device_identifier text,
  api_endpoint      text,
  api_key_hash      text,
  status            device_status NOT NULL DEFAULT 'active',
  last_seen_at      timestamptz,
  created_at        timestamptz DEFAULT now()
);

-- 3.8 device_users (단말기-회원 매핑)
CREATE TABLE device_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  device_id       uuid NOT NULL REFERENCES access_devices(id) ON DELETE CASCADE,
  vendor_user_id  text NOT NULL,
  face_registered boolean DEFAULT false,
  qr_enabled      boolean DEFAULT false,
  card_enabled    boolean DEFAULT false,
  status          text DEFAULT 'active',
  last_synced_at  timestamptz,
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT device_users_vendor_uid_unique UNIQUE (device_id, vendor_user_id)
);

-- 3.9 access_grants (출입권한)
CREATE TABLE access_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  branch_id    uuid NOT NULL REFERENCES branches(id),
  grant_type   grant_type NOT NULL,
  valid_from   timestamptz NOT NULL,
  valid_until  timestamptz,
  status       grant_status NOT NULL DEFAULT 'active',
  reason       text,
  created_at   timestamptz DEFAULT now(),
  revoked_at   timestamptz
);

-- 3.10 access_logs (감사 로그 - 트리거로 UPDATE/DELETE 차단)
CREATE TABLE access_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES branches(id),
  device_id       uuid REFERENCES access_devices(id),
  member_id       uuid REFERENCES members(id),
  credential_type credential_type NOT NULL,
  result          access_result NOT NULL,
  denied_reason   denied_reason,
  raw_event_id    text,
  occurred_at     timestamptz NOT NULL,
  created_at      timestamptz DEFAULT now()
);

-- 3.11 device_sync_jobs (동기화 작업 큐)
CREATE TABLE device_sync_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        uuid NOT NULL REFERENCES branches(id),
  device_id        uuid NOT NULL REFERENCES access_devices(id),
  job_type         sync_job_type NOT NULL,
  target_member_id uuid REFERENCES members(id) ON DELETE SET NULL,
  status           sync_job_status NOT NULL DEFAULT 'pending',
  error_message    text,
  retry_count      int DEFAULT 0,
  created_at       timestamptz DEFAULT now(),
  processed_at     timestamptz
);

-- 3.12 visitor_requests (방문/상담 신청)
CREATE TABLE visitor_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid NOT NULL REFERENCES branches(id),
  name         text NOT NULL,
  phone        text NOT NULL,
  purpose      visit_purpose NOT NULL,
  status       visitor_request_status NOT NULL DEFAULT 'requested',
  approved_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  visit_at     timestamptz,
  created_at   timestamptz DEFAULT now()
);

-- 3.13 consent_records (동의 이력)
CREATE TABLE consent_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  consent_type consent_type NOT NULL,
  agreed       boolean NOT NULL,
  agreed_at    timestamptz DEFAULT now(),
  revoked_at   timestamptz,
  created_at   timestamptz DEFAULT now()
);

-- 3.14 level_progress (레벨 진행)
CREATE TABLE level_progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  tier         level_tier NOT NULL,
  level        int NOT NULL,
  status       level_status NOT NULL DEFAULT 'not_started',
  tested_at    timestamptz,
  approved_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now(),
  CONSTRAINT level_progress_level_range CHECK (level BETWEEN 1 AND 10),
  CONSTRAINT level_progress_unique UNIQUE (member_id, tier, level)
);

-- 3.15 consultation_notes (상담 메모)
CREATE TABLE consultation_notes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id         uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES branches(id),
  coach_id          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  note              text NOT NULL,
  next_followup_at  timestamptz,
  created_at        timestamptz DEFAULT now()
);

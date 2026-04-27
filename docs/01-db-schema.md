# 01. DB 스키마 설계

> Phase 1 산출물 #3 — DB 테이블 설계 (CLAUDE.md L104-186 기반 상세화)
> 작성일: 2026-04-28

---

## 1. 설계 원칙

1. **표준 SQL 우선** — 추후 AWS RDS 이전 가능. Supabase 전용 함수는 RPC 레이어로 격리.
2. **RLS 전면 적용** — 모든 사용자 데이터는 RLS 로 보호. SQL Editor 직접 접근 시에도 권한 우회 불가.
3. **감사 로그 불변** — `access_logs` 는 트리거로 UPDATE/DELETE 차단.
4. **soft delete 지양** — 회원·장비는 status 컬럼으로 상태 관리, 실제 row 삭제는 super_admin 만.
5. **타임스탬프 일관성** — 모든 created_at / updated_at 은 `timestamptz DEFAULT now()`.

---

## 2. ENUM 정의

```sql
-- 회원 상태
CREATE TYPE member_status AS ENUM (
  'active',         -- 정상 이용중
  'trial',          -- 체험권만 보유
  'expired',        -- 이용권 만료
  'suspended',      -- 정지
  'unpaid',         -- 미납
  'withdrawn'       -- 탈퇴
);

-- 이용권 결제 상태
CREATE TYPE payment_status AS ENUM ('paid', 'unpaid', 'partial', 'refunded');

-- 이용권 상태
CREATE TYPE membership_status AS ENUM ('active', 'expired', 'paused', 'canceled');

-- 체험권 상태
CREATE TYPE trial_pass_status AS ENUM ('active', 'used', 'expired', 'canceled');

-- 사용자 역할 (본사 직원 + 가맹점 + 코치 + 회원)
CREATE TYPE user_role AS ENUM (
  'super_admin',    -- 153 본사 최고관리자
  'hq_admin',       -- 본사 관리자
  'branch_owner',   -- 가맹점주/관장
  'branch_manager', -- 지점 관리자
  'coach',          -- 코치
  'member'          -- 회원 (CRM 직접 로그인은 불가, FK 용도)
);

-- 출입 자격증 유형
CREATE TYPE credential_type AS ENUM ('face', 'qr', 'card', 'pin', 'admin', 'visitor');

-- 출입 결과
CREATE TYPE access_result AS ENUM ('success', 'denied', 'error');

-- 거절 사유
CREATE TYPE denied_reason AS ENUM (
  'expired_membership',
  'unpaid',
  'suspended',
  'no_valid_grant',
  'trial_expired',
  'trial_max_used',
  'qr_expired',
  'qr_already_used',
  'qr_invalid_signature',
  'device_error',
  'unknown_user',
  'outside_allowed_time',
  'consent_revoked'
);

-- 단말기 유형
CREATE TYPE device_type AS ENUM ('face_terminal', 'qr_reader', 'card_reader', 'relay', 'kiosk');

-- 단말기 벤더
CREATE TYPE device_vendor AS ENUM ('suprema', 'zkteco', 'hikvision', 'mock', 'custom', 'other');

-- 단말기 상태
CREATE TYPE device_status AS ENUM ('active', 'inactive', 'error');

-- 출입권한 grant 유형
CREATE TYPE grant_type AS ENUM ('membership', 'trial', 'staff', 'admin_override');

-- 출입권한 상태
CREATE TYPE grant_status AS ENUM ('active', 'expired', 'revoked', 'suspended');

-- 동기화 작업 유형
CREATE TYPE sync_job_type AS ENUM (
  'create_user', 'update_user', 'disable_user', 'delete_user',
  'sync_access_group', 'pull_logs'
);

-- 동기화 작업 상태
CREATE TYPE sync_job_status AS ENUM ('pending', 'processing', 'success', 'failed');

-- 방문 목적
CREATE TYPE visit_purpose AS ENUM ('consultation', 'tour', 'trial', 'registration');

-- 방문 요청 상태
CREATE TYPE visitor_request_status AS ENUM ('requested', 'approved', 'denied', 'completed');

-- 동의 유형
CREATE TYPE consent_type AS ENUM ('face_recognition', 'privacy', 'marketing', 'terms');

-- 레벨 티어 / 상태
CREATE TYPE level_tier AS ENUM ('white', 'blue', 'red', 'black');
CREATE TYPE level_status AS ENUM ('not_started', 'in_progress', 'passed', 'failed');
```

---

## 3. 테이블 14종

### 3.1 companies (본사 — 본 프로젝트는 153 1개만)
```sql
CREATE TABLE companies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  business_type text DEFAULT 'franchise',
  created_at   timestamptz DEFAULT now()
);
```

### 3.2 branches (지점)
```sql
CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  name        text NOT NULL,
  address     text,
  phone       text,
  status      text DEFAULT 'active',
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX idx_branches_company ON branches(company_id);
```

### 3.3 profiles (직원/관리자/코치 프로필)
```sql
CREATE TABLE profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role          user_role NOT NULL,
  company_id    uuid REFERENCES companies(id),
  branch_id     uuid REFERENCES branches(id),
  name          text NOT NULL,
  phone         text,
  status        text DEFAULT 'active',
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX idx_profiles_auth ON profiles(auth_user_id);
CREATE INDEX idx_profiles_branch ON profiles(branch_id);
```

회원(`member` 역할) 은 CRM 직접 로그인하지 않으므로 `auth_user_id` 가 NULL 일 수 있음 — 회원 계정은 `members` 테이블 별도 관리.

### 3.4 members (회원)
```sql
CREATE TABLE members (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  branch_id          uuid NOT NULL REFERENCES branches(id),
  name               text NOT NULL,
  phone              text,
  birth_date         date,
  gender             text,
  status             member_status NOT NULL DEFAULT 'trial',
  assigned_coach_id  uuid REFERENCES profiles(id),
  ranking_app_user_id uuid,            -- 랭킹업앱 회원 ID (연동 시)
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX idx_members_branch ON members(branch_id);
CREATE INDEX idx_members_status ON members(branch_id, status);
CREATE INDEX idx_members_coach ON members(assigned_coach_id);
CREATE INDEX idx_members_phone ON members(phone);
```

### 3.5 memberships (이용권)
```sql
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
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_memberships_member ON memberships(member_id);
CREATE INDEX idx_memberships_active ON memberships(member_id, status, end_date);
```

### 3.6 trial_passes (체험권)
```sql
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
  CHECK (used_entries >= 0 AND used_entries <= max_entries)
);
CREATE INDEX idx_trials_member ON trial_passes(member_id, status);
```

### 3.7 access_devices (출입장비)
```sql
CREATE TABLE access_devices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         uuid NOT NULL REFERENCES branches(id),
  device_name       text NOT NULL,
  device_type       device_type NOT NULL,
  vendor            device_vendor NOT NULL,
  model_name        text,
  device_identifier text,            -- vendor 측 시리얼/ID
  api_endpoint      text,            -- vendor API base URL (지점별로 다를 수 있음)
  api_key_hash      text,            -- device_api_key 해시 저장
  status            device_status NOT NULL DEFAULT 'active',
  last_seen_at      timestamptz,
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX idx_devices_branch ON access_devices(branch_id);
CREATE UNIQUE INDEX idx_devices_identifier ON access_devices(vendor, device_identifier);
```

### 3.8 device_users (단말기-회원 매핑)
```sql
CREATE TABLE device_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  device_id       uuid NOT NULL REFERENCES access_devices(id) ON DELETE CASCADE,
  vendor_user_id  text NOT NULL,
  face_registered boolean DEFAULT false,
  qr_enabled      boolean DEFAULT false,
  card_enabled    boolean DEFAULT false,
  status          text DEFAULT 'active',  -- active | disabled | pending_sync | sync_failed
  last_synced_at  timestamptz,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (device_id, vendor_user_id)
);
CREATE INDEX idx_device_users_member ON device_users(member_id);
```

### 3.9 access_grants (출입권한)
```sql
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
CREATE INDEX idx_grants_member_active ON access_grants(member_id, status, valid_until);
```

### 3.10 access_logs (감사 로그 — UPDATE/DELETE 금지)
```sql
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
CREATE INDEX idx_logs_branch_time ON access_logs(branch_id, occurred_at DESC);
CREATE INDEX idx_logs_member_time ON access_logs(member_id, occurred_at DESC);
CREATE INDEX idx_logs_denied ON access_logs(branch_id, result, denied_reason) WHERE result = 'denied';

-- 불변 트리거
CREATE OR REPLACE FUNCTION access_logs_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'access_logs is append-only';
END $$;

CREATE TRIGGER access_logs_no_update BEFORE UPDATE ON access_logs
  FOR EACH ROW EXECUTE FUNCTION access_logs_immutable();
CREATE TRIGGER access_logs_no_delete BEFORE DELETE ON access_logs
  FOR EACH ROW EXECUTE FUNCTION access_logs_immutable();
```

### 3.11 device_sync_jobs (동기화 작업 큐)
```sql
CREATE TABLE device_sync_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        uuid NOT NULL REFERENCES branches(id),
  device_id        uuid NOT NULL REFERENCES access_devices(id),
  job_type         sync_job_type NOT NULL,
  target_member_id uuid REFERENCES members(id),
  status           sync_job_status NOT NULL DEFAULT 'pending',
  error_message    text,
  retry_count      int DEFAULT 0,
  created_at       timestamptz DEFAULT now(),
  processed_at     timestamptz
);
CREATE INDEX idx_sync_pending ON device_sync_jobs(status, created_at) WHERE status IN ('pending', 'failed');
```

### 3.12 visitor_requests (방문/상담 신청)
```sql
CREATE TABLE visitor_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid NOT NULL REFERENCES branches(id),
  name         text NOT NULL,
  phone        text NOT NULL,
  purpose      visit_purpose NOT NULL,
  status       visitor_request_status NOT NULL DEFAULT 'requested',
  approved_by  uuid REFERENCES profiles(id),
  visit_at     timestamptz,
  created_at   timestamptz DEFAULT now()
);
```

### 3.13 consent_records (동의 이력)
```sql
CREATE TABLE consent_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  consent_type consent_type NOT NULL,
  agreed       boolean NOT NULL,
  agreed_at    timestamptz DEFAULT now(),
  revoked_at   timestamptz,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX idx_consents_member ON consent_records(member_id, consent_type);
```

### 3.14 level_progress + consultation_notes
```sql
CREATE TABLE level_progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  tier         level_tier NOT NULL,
  level        int NOT NULL CHECK (level BETWEEN 1 AND 10),
  status       level_status NOT NULL DEFAULT 'not_started',
  tested_at    timestamptz,
  approved_by  uuid REFERENCES profiles(id),
  created_at   timestamptz DEFAULT now(),
  UNIQUE (member_id, tier, level)
);

CREATE TABLE consultation_notes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id         uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES branches(id),
  coach_id          uuid REFERENCES profiles(id),
  note              text NOT NULL,
  next_followup_at  timestamptz,
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX idx_consultations_member ON consultation_notes(member_id, created_at DESC);
```

---

## 4. 권한 헬퍼 함수

```sql
CREATE OR REPLACE FUNCTION has_role(_role user_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE auth_user_id = auth.uid() AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION current_branch_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT branch_id FROM profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_branch_member_of(_member_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m
    WHERE m.id = _member_id AND m.branch_id = current_branch_id()
  );
$$;

CREATE OR REPLACE FUNCTION is_coach_of(_member_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM members m
    JOIN profiles p ON p.id = m.assigned_coach_id
    WHERE m.id = _member_id AND p.auth_user_id = auth.uid()
  );
$$;
```

---

## 5. RLS 정책 가이드 (대표 예시)

```sql
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- super_admin / hq_admin: 전체 조회·수정
CREATE POLICY members_admin_all ON members FOR ALL TO authenticated
  USING (has_role('super_admin') OR has_role('hq_admin'));

-- branch_owner / branch_manager: 자기 지점만
CREATE POLICY members_branch_select ON members FOR SELECT TO authenticated
  USING (
    (has_role('branch_owner') OR has_role('branch_manager'))
    AND branch_id = current_branch_id()
  );

-- coach: 담당 회원만
CREATE POLICY members_coach_select ON members FOR SELECT TO authenticated
  USING (has_role('coach') AND is_coach_of(id));
```

`access_logs` 도 동일 패턴이지만 INSERT 만 허용 (Workers 의 service role 사용), UPDATE/DELETE 는 트리거로 차단.

---

## 6. 인덱스 전략 요약

| 테이블 | 핵심 인덱스 | 용도 |
|---|---|---|
| members | `(branch_id, status)` | 지점 대시보드 회원 수 카운트 |
| memberships | `(member_id, status, end_date)` | 출입 판단 시 active 이용권 확인 |
| access_logs | `(branch_id, occurred_at DESC)` | 지점별 최근 출입 |
| access_logs | `(member_id, occurred_at DESC)` | 회원별 출입 이력 |
| access_logs | `(branch_id, result, denied_reason) WHERE result='denied'` | 거절 원인 분석 |
| device_sync_jobs | `(status, created_at) WHERE status IN ('pending','failed')` | 워커 큐 폴링 |
| access_grants | `(member_id, status, valid_until)` | 권한 유효성 확인 |

---

**다음 문서:** [02-api-design.md](./02-api-design.md) — Workers API 엔드포인트 상세

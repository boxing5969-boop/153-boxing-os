# 153OS — 프랜차이즈 운영 데이터 모델 제안

> 본 문서는 [`FRANCHISE_OS_ROADMAP.md`](./FRANCHISE_OS_ROADMAP.md) §4~7 의 운영 시나리오를 뒷받침하기 위한 **추가 테이블 8종 제안**.
> 본 문서는 **제안서**다. 실제 마이그레이션 작성·실행은 사용자 승인 + 단계별 PR 후 진행.
> 모든 신규 테이블은 기존 RLS 패턴(`company_id` + `branch_id` 기반)을 그대로 따른다.

---

## 0. 기존 데이터 모델 핵심 (그대로 사용)

| 테이블 | 역할 | 변경 필요? |
|---|---|---|
| `companies` | 본사 (멀티테넌트 root) | 변경 0 |
| `branches` | 지점 | 변경 0 (기존 컬럼 활용) |
| `profiles` | 직원·관리자·코치 | 변경 0 |
| `members` | 회원 | 변경 0 |
| `memberships` | 이용권 | 변경 0 |
| `trial_passes` | 체험권 | 변경 0 |
| `access_devices` / `device_users` / `access_grants` / `access_logs` | 출입통제 | 변경 0 |
| `device_sync_jobs` | 단말기 동기화 큐 | 변경 0 |
| `qr_used_tokens` / `emergency_pins` | QR / 비상 PIN | 변경 0 |

→ **기존 21개 마이그레이션은 그대로**. 신규 테이블만 추가하는 비파괴 확장.

---

## 1. 추가 제안 테이블 8종 — 우선순위

| # | 테이블 | 우선 | 의존 | 30/90/180일 |
|---|---|---|---|---|
| 1 | `franchise_contracts` | P2 | branches | 90일 |
| 2 | `branch_onboarding_tasks` | P3 | branches, profiles | 90일 |
| 3 | `branch_kpis` (스냅샷 캐시) | P2 | branches | 90일 |
| 4 | `branch_quality_checks` | P2 | branches, profiles | 90일 |
| 5 | `coach_certifications` | P2 | profiles | 90일 |
| 6 | `coach_education_records` | P2 | profiles | 90일 |
| 7 | `equipment_incidents` | P2 | branches, access_devices, profiles | 90일 |
| 8 | `franchise_notices` / `operating_manuals` | P2 | companies | 90일 |

---

## 2. 테이블 정의

### 2.1 `franchise_contracts` — 가맹점 계약 관리

```sql
CREATE TABLE franchise_contracts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  contract_type   text NOT NULL CHECK (contract_type IN ('new', 'renewal', 'transfer', 'termination')),
  start_date      date NOT NULL,
  end_date        date,
  monthly_fee     numeric(12,2),                     -- 월 가맹비
  royalty_rate    numeric(5,4),                      -- 매출 로열티 비율 (예: 0.0300 = 3%)
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('draft','active','expired','terminated')),
  contract_pdf_url text,                             -- R2 또는 Supabase Storage
  signed_at       timestamptz,
  signed_by       uuid REFERENCES profiles(id),
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_franchise_contracts_branch  ON franchise_contracts(branch_id);
CREATE INDEX idx_franchise_contracts_status  ON franchise_contracts(status);
```

**RLS**: hq_admin 전체, branch_admin 자기 지점, 그 외 거절.
**용도**: 본사 화면 "이번 달 만료 예정 계약 N건", 자동 갱신 알림 cron.

---

### 2.2 `branch_onboarding_tasks` — 가맹점 오픈 체크리스트

```sql
CREATE TYPE onboarding_task_status AS ENUM ('not_started','in_progress','blocked','completed','skipped');

CREATE TABLE branch_onboarding_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  task_code       text NOT NULL,                    -- 'contract_signed', 'devices_installed' 등
  task_label      text NOT NULL,                    -- 한글 표시
  task_order      int  NOT NULL,                    -- 1~11 (UI 순서)
  status          onboarding_task_status NOT NULL DEFAULT 'not_started',
  due_date        date,
  assignee_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at    timestamptz,
  completed_by    uuid REFERENCES profiles(id),
  evidence_url    text,                             -- 사진/문서 R2 URL
  approval_status text CHECK (approval_status IN ('pending','approved','rejected')),
  approved_by     uuid REFERENCES profiles(id),
  approved_at     timestamptz,
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT branch_onboarding_unique UNIQUE (branch_id, task_code)
);
```

**11단계 task 시드** (마이그레이션에 함께 INSERT):

| order | task_code | task_label |
|---|---|---|
| 1 | contract_signed | 계약 체결 |
| 2 | business_registration_verified | 사업자등록 확인 |
| 3 | interior_completed | 인테리어 완료 |
| 4 | signage_installed | 간판 설치 |
| 5 | access_devices_installed | 출입장비 설치 |
| 6 | qr_face_test_passed | QR/얼굴인식 테스트 |
| 7 | coach_education_completed | 코치 교육 완료 |
| 8 | manuals_acknowledged | 운영 매뉴얼 숙지 |
| 9 | kakao_template_verified | 알림톡 템플릿 발송 검증 |
| 10 | hq_pre_open_inspection | 오픈 전 본사 점검 |
| 11 | hq_final_approval | 본사 최종 승인 |

**RPC 제안**:
- `provision_new_branch_onboarding(_branch_id uuid)` — branch 등록 시 11개 task row 자동 생성
- `complete_onboarding_task(_task_id uuid, _evidence_url text)` — 담당자 완료 처리
- `approve_onboarding_task(_task_id uuid)` — 본사 승인 (hq_admin only)

---

### 2.3 `branch_kpis` — KPI 스냅샷 캐시

```sql
CREATE TABLE branch_kpis (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  snapshot_date   date NOT NULL,                    -- KPI 기준일 (보통 자정)
  -- 회원
  member_total       int NOT NULL DEFAULT 0,
  member_active      int NOT NULL DEFAULT 0,
  member_expired     int NOT NULL DEFAULT 0,
  member_unpaid      int NOT NULL DEFAULT 0,
  member_trial       int NOT NULL DEFAULT 0,
  -- 신규 / 재등록
  new_signups_30d    int NOT NULL DEFAULT 0,
  renewals_30d       int NOT NULL DEFAULT 0,
  trial_conversions_30d int NOT NULL DEFAULT 0,    -- 체험권 → 정회원 전환
  -- 출입
  access_today       int NOT NULL DEFAULT 0,
  access_denied_today int NOT NULL DEFAULT 0,
  access_unauthorized_30d int NOT NULL DEFAULT 0,  -- 무단 출입 시도(unknown_user)
  -- 매출 (memberships.price 합산 — 향후)
  revenue_30d        numeric(14,2),
  -- 코치
  coach_count        int NOT NULL DEFAULT 0,
  coach_quality_avg  numeric(4,2),                  -- 0~10
  created_at         timestamptz DEFAULT now(),
  CONSTRAINT branch_kpis_unique UNIQUE (branch_id, snapshot_date)
);
CREATE INDEX idx_branch_kpis_date ON branch_kpis(snapshot_date DESC);
```

**갱신**: cron 매일 자정 — `runDailyKpiSnapshot()` (Workers).
**용도**: 본사 대시보드의 추세 차트 (지난 90일 활성 회원 추이 등) — 매번 raw 집계 대신 cached row.

> 1차 단계에서는 이 테이블 없이 **on-the-fly RPC 집계**로 시작 (KPI 문서 §1차 참조). 2차에서 도입.

---

### 2.4 `branch_quality_checks` — 본사 품질 평가

```sql
CREATE TABLE branch_quality_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  inspector_id    uuid NOT NULL REFERENCES profiles(id),
  check_date      date NOT NULL,
  category        text NOT NULL,                    -- 'cleanliness','safety','coach','equipment'
  score           int NOT NULL CHECK (score BETWEEN 0 AND 10),
  comment         text,
  evidence_url    text,
  follow_up_due   date,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','resolved','overdue','dismissed')),
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_quality_checks_branch ON branch_quality_checks(branch_id, check_date DESC);
```

**용도**: 본사 분기 점검. 특정 카테고리 평균 점수 7 미만 → 경고 알림톡.

---

### 2.5 `coach_certifications` — 코치 자격

```sql
CREATE TABLE coach_certifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cert_type       text NOT NULL,                    -- '생활체육지도사2급','153_internal','first_aid'
  cert_name       text NOT NULL,
  issuer          text NOT NULL,
  issued_at       date NOT NULL,
  expires_at      date,                             -- NULL = 평생
  cert_number     text,
  evidence_url    text,                             -- 자격증 사본 R2
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','expired','revoked')),
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_coach_certs_coach   ON coach_certifications(coach_id);
CREATE INDEX idx_coach_certs_expires ON coach_certifications(expires_at) WHERE expires_at IS NOT NULL;
```

**자동화**: cron 매일 — expires_at <= today → status='expired' + 본사·지점장 알림톡.

---

### 2.6 `coach_education_records` — 본사 교육 이수

```sql
CREATE TYPE coach_education_type AS ENUM ('onboarding','annual_refresh','safety','specialty');

CREATE TABLE coach_education_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  education_type  coach_education_type NOT NULL,
  course_name     text NOT NULL,
  hours           numeric(5,2) NOT NULL,
  completed_at    timestamptz NOT NULL,
  trainer_id      uuid REFERENCES profiles(id),
  passing_score   int,
  certificate_url text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_coach_edu_coach ON coach_education_records(coach_id, completed_at DESC);
```

**용도**:
- "보수 교육 1년 1회" 미이수 코치 자동 알림
- 코치 상세 페이지 교육 이력 타임라인

---

### 2.7 `equipment_incidents` — 장비 장애 티켓

```sql
CREATE TYPE incident_severity AS ENUM ('info','warning','critical');
CREATE TYPE incident_status   AS ENUM ('open','acknowledged','in_progress','resolved','closed');

CREATE TABLE equipment_incidents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  device_id       uuid REFERENCES access_devices(id) ON DELETE SET NULL,
  reporter_id     uuid REFERENCES profiles(id),    -- NULL = 자동 탐지
  severity        incident_severity NOT NULL DEFAULT 'warning',
  symptom_code    text NOT NULL,                    -- 'device_offline','sync_fail','door_jam'
  description     text,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES profiles(id),
  resolution_note text,
  status          incident_status NOT NULL DEFAULT 'open',
  sla_breach_at   timestamptz,                      -- severity 별 SLA 위반 시각
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_incidents_branch ON equipment_incidents(branch_id, status, detected_at DESC);
CREATE INDEX idx_incidents_open   ON equipment_incidents(status) WHERE status NOT IN ('resolved','closed');
```

**자동 생성**:
- `access_devices.last_seen_at < now() - 5m` → severity='warning', symptom='device_offline'
- `device_sync_jobs.retry_count >= 3` → severity='warning', symptom='sync_fail'
- 동일 device 의 동일 symptom 미해결 row 가 있으면 중복 생성 방지

**RPC**:
- `acknowledge_incident(_id)` — 지점장이 인지
- `resolve_incident(_id, _note)` — 해결 처리

---

### 2.8 `franchise_notices` / `operating_manuals` — 본사 공지·매뉴얼

```sql
CREATE TABLE franchise_notices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title           text NOT NULL,
  body            text NOT NULL,                    -- markdown
  category        text,                             -- 'policy','event','warning'
  audience        text NOT NULL DEFAULT 'all'
                  CHECK (audience IN ('all','branch_admin','coach','staff')),
  published_at    timestamptz,
  expires_at      timestamptz,
  pinned          boolean NOT NULL DEFAULT false,
  send_kakao      boolean NOT NULL DEFAULT false,   -- true 시 cron 이 알림톡 발송
  created_by      uuid NOT NULL REFERENCES profiles(id),
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_notices_published ON franchise_notices(company_id, published_at DESC);

CREATE TABLE operating_manuals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  manual_code     text NOT NULL,                    -- 'cleaning','equipment_use','member_consultation'
  title           text NOT NULL,
  version         text NOT NULL,                    -- '1.2.0'
  body_url        text NOT NULL,                    -- R2/Storage URL (PDF or markdown)
  effective_from  date NOT NULL,
  superseded_by   uuid REFERENCES operating_manuals(id),
  created_by      uuid NOT NULL REFERENCES profiles(id),
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT manuals_unique_version UNIQUE (company_id, manual_code, version)
);
```

**용도**:
- 본사 공지 발행 → 모든 지점 admin 화면 상단 배너
- 매뉴얼 버전 관리 + 신규 가맹점 task #8 (manuals_acknowledged) 와 연계

---

## 3. 가맹점 온보딩 체크리스트 — 운영 매뉴얼 매핑

각 task 의 완료 기준 / 증거 / 본사 승인 여부:

| order | task | 완료 기준 | 증거 (evidence_url) | 본사 승인? |
|---|---|---|---|---|
| 1 | 계약 체결 | franchise_contracts.status='active' | 계약서 PDF | hq_admin |
| 2 | 사업자등록 확인 | 등록증 사본 업로드 | 사업자등록증 사진 | hq_admin |
| 3 | 인테리어 완료 | 본사 점검자가 시각 확인 | 시공 후 사진 ≥3장 | hq_admin |
| 4 | 간판 설치 | 본사 디자인 가이드 부합 | 간판 사진 (낮+밤) | hq_admin |
| 5 | 출입장비 설치 | access_devices N개 status='active' | 설치 사진 + 모델 시리얼 | branch_admin (자기 검증 후) |
| 6 | QR/얼굴인식 테스트 | verify endpoint 5회 성공 | 테스트 access_logs | branch_admin |
| 7 | 코치 교육 완료 | coach_education_records 입문 N건 | trainer 서명 | hq_admin |
| 8 | 운영 매뉴얼 숙지 | manuals 모든 active 버전 read | 체크리스트 결재 | branch_admin |
| 9 | 알림톡 템플릿 발송 검증 | branch_kakao_settings 검증 + 본사 테스트 SMS | sandbox 발송 로그 | branch_admin |
| 10 | 오픈 전 본사 점검 | branch_quality_checks 통과 점수 ≥8 | 점검 보고서 | hq_admin |
| 11 | 본사 최종 승인 | 위 10개 모두 approved | — | hq_admin (단독 액션) |

→ task 11 까지 통과해야 `branches.status='active'` 가 set 되도록 RPC `complete_branch_onboarding()` 에서 가드.

---

## 4. RLS 정책 표준 패턴

모든 신규 테이블 동일 패턴 적용:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

-- hq: 자사 company 전체
CREATE POLICY "<table>_hq_select" ON <table>
  FOR SELECT TO authenticated
  USING (
    branch_id IN (
      SELECT b.id FROM branches b
      JOIN profiles p ON p.company_id = b.company_id
      WHERE p.auth_user_id = auth.uid()
    )
  );

-- branch_admin: 자기 지점만
CREATE POLICY "<table>_branch_select" ON <table>
  FOR SELECT TO authenticated
  USING (
    branch_id IN (
      SELECT branch_id FROM profiles
      WHERE auth_user_id = auth.uid()
    )
  );
```

INSERT/UPDATE/DELETE 는 SECURITY DEFINER RPC 경유 — 정책상 frontend 에서 직접 변경 금지.

---

## 5. 구현 순서

### 30일 (Day 0~30) — 신규 마이그레이션 0
- 기존 데이터로 KPI 1차 (별도 테이블 없이 RPC 집계)

### 90일 (Day 31~90) — 신규 마이그레이션 7개
1. `20260601000000_franchise_contracts.sql`
2. `20260602000000_branch_onboarding_tasks.sql` + 11 task 시드
3. `20260603000000_coach_certifications.sql`
4. `20260604000000_coach_education_records.sql`
5. `20260605000000_equipment_incidents.sql` + 자동 생성 cron
6. `20260606000000_franchise_notices.sql`
7. `20260607000000_operating_manuals.sql`

### 180일 (Day 91~180) — 신규 마이그레이션 1~2개
8. `20260701000000_branch_kpis.sql` (스냅샷 캐시)
9. `20260702000000_branch_quality_checks.sql`

각 마이그레이션은 단독 PR + Lovable/SQL Editor 수동 적용 + 운영 검증 후 다음으로.

---

## 6. 결제·payment 영역과 격리

본 데이터 모델 제안에서 **payment / payssam / 결제선생 관련 신규 테이블은 의도적으로 제외**.

- 결제 정산 / 매출 집계는 `branch_kpis.revenue_30d` 의 단일 컬럼으로만 시작
- 정식 결제 모듈은 [`FRANCHISE_OS_ROADMAP.md`](./FRANCHISE_OS_ROADMAP.md) §9 의 8개 조건 충족 후 별도 PR 로 진행
- 그 전엔 `memberships.price` (이미 추가됨) 합산만으로 매출 추정

---

*이 문서는 데이터 설계 합의용 제안서다. 사용자 승인 + 단계별 마이그레이션 PR 후에만 운영 DB 에 반영된다.*

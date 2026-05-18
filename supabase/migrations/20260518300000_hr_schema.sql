-- ============================================================
-- HR 스키마: 직원 관리 + 계약서 + 급여 명세
-- ============================================================
-- employment_type:
--   regular    = 정직원 (4대보험 전체)
--   parttime   = 파트타임 (월 60시간 이상 시 4대보험)
--   freelancer = 프리랜서 (3.3% 원천징수)
--   owner      = 대표/관장 (별도 처리)
-- ============================================================

-- 1. 직원 테이블
CREATE TABLE IF NOT EXISTS staff (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  birth_date        DATE,
  gender            TEXT CHECK (gender IN ('male', 'female', 'other')),
  -- 은행 정보
  bank_name         TEXT,
  bank_account      TEXT,
  bank_holder       TEXT,
  -- 고용 정보
  employment_type   TEXT NOT NULL CHECK (employment_type IN ('regular', 'parttime', 'freelancer', 'owner')),
  position          TEXT,                -- 직책 (코치, 트레이너, 관리자 등)
  start_date        DATE,
  end_date          DATE,
  -- 급여 정보
  base_salary       INTEGER,             -- 월급 (원)
  hourly_wage       INTEGER,             -- 시급 (원)
  weekly_hours      NUMERIC(5,2),        -- 주당 계약 시간
  -- 상태
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'resigned')),
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_branch_id ON staff(branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff(status);

-- 2. 직원 계약서 테이블
CREATE TABLE IF NOT EXISTS staff_contracts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id        UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  -- 계약서 정보
  contract_type   TEXT NOT NULL CHECK (contract_type IN ('employment', 'parttime', 'freelance', 'renewal', 'other')),
  title           TEXT NOT NULL,         -- 계약서 제목
  content         JSONB,                 -- 계약서 본문 (JSON 구조)
  file_url        TEXT,                  -- R2 저장 URL (PDF 업로드 시)
  -- 상태
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'expired', 'canceled')),
  -- 계약 기간
  valid_from      DATE,
  valid_until     DATE,
  -- 발송/서명 기록
  sent_at         TIMESTAMPTZ,
  sent_to_phone   TEXT,                  -- 발송한 연락처
  sent_to_email   TEXT,
  signed_at       TIMESTAMPTZ,
  -- 메타
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_contracts_staff_id ON staff_contracts(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_contracts_branch_id ON staff_contracts(branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_contracts_status ON staff_contracts(status);

-- 3. 급여 명세 테이블
CREATE TABLE IF NOT EXISTS staff_payroll (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id                UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  branch_id               UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  year                    INTEGER NOT NULL,
  month                   INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  -- 지급 내역
  base_pay                INTEGER NOT NULL DEFAULT 0,   -- 기본급
  allowance               INTEGER NOT NULL DEFAULT 0,   -- 각종 수당
  bonus                   INTEGER NOT NULL DEFAULT 0,   -- 상여금
  gross_pay               INTEGER NOT NULL DEFAULT 0,   -- 지급 합계
  -- 4대보험 공제 (근로자 부담) — 정직원/파트타임
  national_pension        INTEGER NOT NULL DEFAULT 0,   -- 국민연금 4.5%
  health_insurance        INTEGER NOT NULL DEFAULT 0,   -- 건강보험 3.545%
  long_term_care          INTEGER NOT NULL DEFAULT 0,   -- 장기요양 (건강보험료 × 12.95%)
  employment_insurance    INTEGER NOT NULL DEFAULT 0,   -- 고용보험 0.9%
  -- 소득세 공제
  income_tax              INTEGER NOT NULL DEFAULT 0,   -- 소득세
  local_income_tax        INTEGER NOT NULL DEFAULT 0,   -- 지방소득세 (소득세 × 10%)
  -- 프리랜서 원천징수
  withholding_tax         INTEGER NOT NULL DEFAULT 0,   -- 3.3% 원천징수 (소득세 3% + 지방 0.3%)
  -- 기타 공제
  other_deduction         INTEGER NOT NULL DEFAULT 0,
  total_deduction         INTEGER NOT NULL DEFAULT 0,   -- 공제 합계
  net_pay                 INTEGER NOT NULL DEFAULT 0,   -- 실수령액
  -- 사업주 부담 4대보험
  employer_pension        INTEGER NOT NULL DEFAULT 0,   -- 국민연금 4.5%
  employer_health         INTEGER NOT NULL DEFAULT 0,   -- 건강보험 3.545%
  employer_long_term_care INTEGER NOT NULL DEFAULT 0,   -- 장기요양 50%
  employer_employment     INTEGER NOT NULL DEFAULT 0,   -- 고용보험 1.15% (150인 미만)
  employer_accident       INTEGER NOT NULL DEFAULT 0,   -- 산재보험 (업종별, 헬스장 ~1%)
  employer_total          INTEGER NOT NULL DEFAULT 0,   -- 사업주 부담 합계
  -- 실지급 정보
  work_hours              NUMERIC(6,2),                 -- 실제 근무 시간 (시급제)
  work_days               INTEGER,                      -- 실제 근무 일수
  memo                    TEXT,
  status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'paid')),
  paid_at                 TIMESTAMPTZ,
  created_by              UUID REFERENCES profiles(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_staff_id ON staff_payroll(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_payroll_branch_year_month ON staff_payroll(branch_id, year, month);
CREATE INDEX IF NOT EXISTS idx_staff_payroll_status ON staff_payroll(status);

-- ============================================================
-- updated_at 자동 갱신 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- staff 트리거 (함수는 이미 존재할 수 있으므로 CREATE OR REPLACE 사용)
DROP TRIGGER IF EXISTS trg_staff_updated_at ON staff;
CREATE TRIGGER trg_staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_staff_contracts_updated_at ON staff_contracts;
CREATE TRIGGER trg_staff_contracts_updated_at
  BEFORE UPDATE ON staff_contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_staff_payroll_updated_at ON staff_payroll;
CREATE TRIGGER trg_staff_payroll_updated_at
  BEFORE UPDATE ON staff_payroll
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- RLS 정책
-- ============================================================
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_payroll ENABLE ROW LEVEL SECURITY;

-- staff: super_admin/hq_admin은 전체, branch_owner/branch_manager는 자기 지점
CREATE POLICY "staff_select" ON staff FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.auth_user_id = auth.uid()
        AND (
          p.role IN ('super_admin', 'hq_admin')
          OR (p.role IN ('branch_owner', 'branch_manager', 'coach') AND p.branch_id = staff.branch_id)
        )
    )
  );

CREATE POLICY "staff_insert" ON staff FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.auth_user_id = auth.uid()
        AND (
          p.role IN ('super_admin', 'hq_admin')
          OR (p.role IN ('branch_owner', 'branch_manager') AND p.branch_id = branch_id)
        )
    )
  );

CREATE POLICY "staff_update" ON staff FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.auth_user_id = auth.uid()
        AND (
          p.role IN ('super_admin', 'hq_admin')
          OR (p.role IN ('branch_owner', 'branch_manager') AND p.branch_id = staff.branch_id)
        )
    )
  );

CREATE POLICY "staff_delete" ON staff FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.role IN ('super_admin', 'hq_admin', 'branch_owner')
    )
  );

-- staff_contracts: staff와 동일한 지점 접근 제어
CREATE POLICY "staff_contracts_select" ON staff_contracts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.auth_user_id = auth.uid()
        AND (
          p.role IN ('super_admin', 'hq_admin')
          OR (p.role IN ('branch_owner', 'branch_manager') AND p.branch_id = staff_contracts.branch_id)
        )
    )
  );

CREATE POLICY "staff_contracts_insert" ON staff_contracts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.auth_user_id = auth.uid()
        AND (
          p.role IN ('super_admin', 'hq_admin')
          OR (p.role IN ('branch_owner', 'branch_manager') AND p.branch_id = branch_id)
        )
    )
  );

CREATE POLICY "staff_contracts_update" ON staff_contracts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.auth_user_id = auth.uid()
        AND (
          p.role IN ('super_admin', 'hq_admin')
          OR (p.role IN ('branch_owner', 'branch_manager') AND p.branch_id = staff_contracts.branch_id)
        )
    )
  );

-- staff_payroll: 지점 관리자 이상만 접근
CREATE POLICY "staff_payroll_select" ON staff_payroll FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.auth_user_id = auth.uid()
        AND (
          p.role IN ('super_admin', 'hq_admin')
          OR (p.role IN ('branch_owner', 'branch_manager') AND p.branch_id = staff_payroll.branch_id)
        )
    )
  );

CREATE POLICY "staff_payroll_insert" ON staff_payroll FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.auth_user_id = auth.uid()
        AND (
          p.role IN ('super_admin', 'hq_admin')
          OR (p.role IN ('branch_owner', 'branch_manager') AND p.branch_id = branch_id)
        )
    )
  );

CREATE POLICY "staff_payroll_update" ON staff_payroll FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.auth_user_id = auth.uid()
        AND (
          p.role IN ('super_admin', 'hq_admin')
          OR (p.role IN ('branch_owner', 'branch_manager') AND p.branch_id = staff_payroll.branch_id)
        )
    )
  );

-- ============================================================
-- 급여 합계 자동 계산 함수 (RPC)
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_payroll(
  _employment_type  TEXT,
  _base_pay         INTEGER,
  _allowance        INTEGER DEFAULT 0,
  _bonus            INTEGER DEFAULT 0,
  _work_hours       NUMERIC DEFAULT NULL,  -- 시급제용
  _hourly_wage      INTEGER DEFAULT NULL   -- 시급
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  gross_pay         INTEGER;
  -- 근로자 공제
  national_pension  INTEGER := 0;
  health_ins        INTEGER := 0;
  long_term_care    INTEGER := 0;
  emp_insurance     INTEGER := 0;
  income_tax        INTEGER := 0;
  local_income_tax  INTEGER := 0;
  withholding_tax   INTEGER := 0;
  total_deduction   INTEGER;
  net_pay           INTEGER;
  -- 사업주 부담
  er_pension        INTEGER := 0;
  er_health         INTEGER := 0;
  er_long_care      INTEGER := 0;
  er_emp_ins        INTEGER := 0;
  er_accident       INTEGER := 0;
  er_total          INTEGER;
BEGIN
  -- 시급제인 경우 기본급 계산
  IF _work_hours IS NOT NULL AND _hourly_wage IS NOT NULL THEN
    _base_pay := ROUND(_work_hours * _hourly_wage);
  END IF;

  gross_pay := COALESCE(_base_pay, 0) + COALESCE(_allowance, 0) + COALESCE(_bonus, 0);

  IF _employment_type IN ('regular', 'parttime') THEN
    -- 4대보험 (근로자)
    national_pension := ROUND(gross_pay * 0.045);       -- 국민연금 4.5%
    health_ins       := ROUND(gross_pay * 0.03545);     -- 건강보험 3.545%
    long_term_care   := ROUND(health_ins * 0.1295);     -- 장기요양 12.95% of 건강보험료
    emp_insurance    := ROUND(gross_pay * 0.009);       -- 고용보험 0.9%
    -- 간이세액표 근사값 (정확한 계산은 국세청 API 또는 세액표 필요)
    -- 여기서는 3% 소득세 근사 (실무에서 세액표 참고)
    income_tax       := ROUND(gross_pay * 0.033);
    local_income_tax := ROUND(income_tax * 0.1);
    -- 사업주 부담
    er_pension   := ROUND(gross_pay * 0.045);
    er_health    := ROUND(gross_pay * 0.03545);
    er_long_care := ROUND(health_ins * 0.1295);
    er_emp_ins   := ROUND(gross_pay * 0.0115);          -- 고용보험 1.15%
    er_accident  := ROUND(gross_pay * 0.01);            -- 산재 ~1% (헬스장)

  ELSIF _employment_type = 'freelancer' THEN
    -- 프리랜서 3.3% 원천징수
    withholding_tax := ROUND(gross_pay * 0.033);
  END IF;

  total_deduction := national_pension + health_ins + long_term_care + emp_insurance
                   + income_tax + local_income_tax + withholding_tax;
  net_pay         := gross_pay - total_deduction;
  er_total        := er_pension + er_health + er_long_care + er_emp_ins + er_accident;

  RETURN jsonb_build_object(
    'gross_pay',              gross_pay,
    'national_pension',       national_pension,
    'health_insurance',       health_ins,
    'long_term_care',         long_term_care,
    'employment_insurance',   emp_insurance,
    'income_tax',             income_tax,
    'local_income_tax',       local_income_tax,
    'withholding_tax',        withholding_tax,
    'total_deduction',        total_deduction,
    'net_pay',                net_pay,
    'employer_pension',       er_pension,
    'employer_health',        er_health,
    'employer_long_term_care',er_long_care,
    'employer_employment',    er_emp_ins,
    'employer_accident',      er_accident,
    'employer_total',         er_total
  );
END;
$$;

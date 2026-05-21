-- ============================================================
-- FC AI Care Center 1차-②: 회원 분석 테이블
-- ============================================================
-- member_status_snapshots : 매일 회원 상태를 계산해 저장 (분석 엔진이 적재)
-- member_segments         : 회원별 다중 세그먼트 부여
-- ============================================================

-- ── member_status_snapshots ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_status_snapshots (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id                  uuid REFERENCES public.brands(id)   ON DELETE SET NULL,
  branch_id                 uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_id                 uuid NOT NULL REFERENCES public.members(id)  ON DELETE CASCADE,
  snapshot_date             date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  product_type              text CHECK (product_type IN
                              ('boxing','gym','pt','spinning','boxing_gym','group_class','trial','event')),
  lifecycle_stage           text CHECK (lifecycle_stage IN
                              ('new_0_7_days','new_8_30_days','habit_building','active','attendance_risk',
                               'dormant','renewal_d30','renewal_d14','renewal_d7','expired','winback')),
  behavior_segment          text,
  last_visit_at             timestamptz,
  days_since_last_visit     int,
  usual_visit_frequency     numeric(5,2),   -- 평소 주당 출석 횟수
  attendance_rhythm_status  text CHECK (attendance_rhythm_status IN
                              ('normal','slowing','at_risk','dormant')),
  membership_expiry_date    date,
  days_until_expiry         int,
  payment_status            text,
  pt_remaining_sessions     int,
  satisfaction_score        numeric(4,2),
  churn_risk_score          numeric(5,2),   -- 0~100
  renewal_opportunity_score numeric(5,2),
  pt_conversion_score       numeric(5,2),
  referral_potential_score  numeric(5,2),
  created_at                timestamptz NOT NULL DEFAULT now()
);
-- 회원당 하루 1스냅샷 (재계산 시 upsert)
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_snapshot_day
  ON public.member_status_snapshots(member_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_member_snapshot_branch
  ON public.member_status_snapshots(branch_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_member_snapshot_risk
  ON public.member_status_snapshots(branch_id, snapshot_date, churn_risk_score DESC);

-- ── member_segments ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_segments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  brand_id     uuid REFERENCES public.brands(id)   ON DELETE SET NULL,
  branch_id    uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES public.members(id)  ON DELETE CASCADE,
  segment_key  text NOT NULL,                  -- 예: 15_days_absent, boxing_member, renewal_d14
  source       text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_segment
  ON public.member_segments(member_id, segment_key);
CREATE INDEX IF NOT EXISTS idx_member_segments_branch
  ON public.member_segments(branch_id, segment_key);

-- ── 테넌시 자동채움 ─────────────────────────────────────────
CREATE OR REPLACE TRIGGER trg_member_snapshots_fill
  BEFORE INSERT ON public.member_status_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();
CREATE OR REPLACE TRIGGER trg_member_segments_fill
  BEFORE INSERT ON public.member_segments
  FOR EACH ROW EXECUTE FUNCTION public.fill_tenancy_from_branch();

-- ── RLS (Phase B 헬퍼 재사용) ───────────────────────────────
ALTER TABLE public.member_status_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_segments         ENABLE ROW LEVEL SECURITY;
GRANT ALL    ON public.member_status_snapshots, public.member_segments TO service_role;
GRANT SELECT ON public.member_status_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_segments TO authenticated;

-- 스냅샷: 조회 전용(적재는 분석 배치=service_role). accountant 전용 제외.
CREATE POLICY member_snapshots_read ON public.member_status_snapshots
  FOR SELECT TO authenticated
  USING (public.has_branch_access(branch_id) AND NOT public.is_accountant_only());

-- 세그먼트: 조회 + (비-viewer·비-accountant 전용) 쓰기
CREATE POLICY member_segments_read ON public.member_segments
  FOR SELECT TO authenticated
  USING (public.has_branch_access(branch_id) AND NOT public.is_accountant_only());
CREATE POLICY member_segments_write ON public.member_segments
  FOR ALL TO authenticated
  USING (public.has_branch_access(branch_id)
         AND NOT public.is_viewer_only() AND NOT public.is_accountant_only())
  WITH CHECK (public.has_branch_access(branch_id)
         AND NOT public.is_viewer_only() AND NOT public.is_accountant_only());

DO $$ BEGIN
  RAISE NOTICE 'FC 1차-②: member_status_snapshots + member_segments 완료';
END $$;

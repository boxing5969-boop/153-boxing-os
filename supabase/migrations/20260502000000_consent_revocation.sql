-- Phase 11 마이그레이션: 동의 철회 자동 처리
-- 1) consent_records 트리거: face_recognition 철회 시 자동으로 단말기 delete_user 큐잉
-- 2) revoke_member_consent() RPC: CRM 에서 호출하는 단일 진입점
-- 3) list_member_consents(): 회원 동의 이력 조회

-- ============================================================
-- 1) 트리거 함수 — 동의 철회 시 단말기 삭제 작업 자동 enqueue
-- ============================================================
CREATE OR REPLACE FUNCTION public.consent_revocation_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 발화 조건: agreed=false INSERT 또는 revoked_at NULL→NOT NULL UPDATE
  IF (TG_OP = 'INSERT' AND NEW.agreed = false)
     OR (TG_OP = 'UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL) THEN
    -- face_recognition 철회 시 단말기에서 영구 삭제
    IF NEW.consent_type = 'face_recognition' THEN
      PERFORM public.enqueue_member_sync(NEW.member_id, 'delete_user');
    END IF;
    -- privacy 철회: members.status='withdrawn' 검토 (운영 정책 결정 사항)
    -- 현재는 face_recognition 만 자동 처리. privacy/marketing/terms 는 운영 매뉴얼 참조.
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS consent_revocation_sync_trigger ON consent_records;
CREATE TRIGGER consent_revocation_sync_trigger
  AFTER INSERT OR UPDATE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION consent_revocation_trigger();

-- ============================================================
-- 2) revoke_member_consent() — CRM 에서 호출하는 단일 진입점
-- ============================================================
CREATE OR REPLACE FUNCTION public.revoke_member_consent(
  _member_id uuid,
  _consent_type consent_type
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jobs_created int := 0;
  revoked_count int := 0;
BEGIN
  -- 권한: hq 또는 자기 지점 회원의 branch_admin/coach
  IF NOT (
    public.is_hq_admin()
    OR (public.is_branch_admin() AND public.is_branch_member_of(_member_id))
    OR (public.has_role('coach') AND public.is_coach_of(_member_id))
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- 기존 active 동의 철회 (revoked_at = now)
  WITH updated AS (
    UPDATE consent_records
       SET revoked_at = now()
     WHERE member_id = _member_id
       AND consent_type = _consent_type
       AND agreed = true
       AND revoked_at IS NULL
     RETURNING id
  )
  SELECT count(*) INTO revoked_count FROM updated;

  -- 철회 기록 (audit 용)
  INSERT INTO consent_records (member_id, consent_type, agreed, agreed_at, revoked_at)
  VALUES (_member_id, _consent_type, false, now(), now());

  -- face_recognition 의 경우 트리거가 자동으로 delete_user enqueue
  IF _consent_type = 'face_recognition' THEN
    SELECT count(*) INTO jobs_created
    FROM device_sync_jobs
    WHERE target_member_id = _member_id
      AND job_type = 'delete_user'
      AND created_at > now() - INTERVAL '5 seconds';
  END IF;

  RETURN jsonb_build_object(
    'member_id', _member_id,
    'consent_type', _consent_type,
    'revoked_count', revoked_count,
    'sync_jobs_created', jobs_created,
    'revoked_at', now()
  );
END $$;

GRANT EXECUTE ON FUNCTION public.revoke_member_consent(uuid, consent_type) TO authenticated;

-- ============================================================
-- 3) list_member_consents() — 회원 동의 이력
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_member_consents(_member_id uuid)
RETURNS TABLE (
  id uuid,
  consent_type consent_type,
  agreed boolean,
  agreed_at timestamptz,
  revoked_at timestamptz,
  is_active boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id,
    consent_type,
    agreed,
    agreed_at,
    revoked_at,
    (agreed = true AND revoked_at IS NULL) AS is_active
  FROM consent_records
  WHERE member_id = _member_id
  ORDER BY agreed_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_member_consents(uuid) TO authenticated;

-- ============================================================
-- 4) record_member_consent() — 새 동의 기록 (CRM 에서 사용)
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_member_consent(
  _member_id uuid,
  _consent_type consent_type
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT (
    public.is_hq_admin()
    OR (public.is_branch_admin() AND public.is_branch_member_of(_member_id))
    OR (public.has_role('coach') AND public.is_coach_of(_member_id))
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  INSERT INTO consent_records (member_id, consent_type, agreed, agreed_at)
  VALUES (_member_id, _consent_type, true, now())
  RETURNING id INTO new_id;

  RETURN jsonb_build_object(
    'consent_id', new_id,
    'member_id', _member_id,
    'consent_type', _consent_type,
    'agreed_at', now()
  );
END $$;

GRANT EXECUTE ON FUNCTION public.record_member_consent(uuid, consent_type) TO authenticated;

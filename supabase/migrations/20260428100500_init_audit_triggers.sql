-- Phase 3 마이그레이션 6/6: 감사 로그 불변 트리거 + updated_at 자동 갱신
-- 참조: docs/01-db-schema.md §3.10

-- access_logs 는 append-only — UPDATE/DELETE 시 RAISE
CREATE OR REPLACE FUNCTION public.access_logs_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'access_logs is append-only (UPDATE/DELETE forbidden)';
END $$;

CREATE TRIGGER access_logs_no_update
  BEFORE UPDATE ON access_logs
  FOR EACH ROW EXECUTE FUNCTION access_logs_immutable();

CREATE TRIGGER access_logs_no_delete
  BEFORE DELETE ON access_logs
  FOR EACH ROW EXECUTE FUNCTION access_logs_immutable();

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER members_touch_updated
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER memberships_touch_updated
  BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

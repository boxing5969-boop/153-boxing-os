-- Phase 21 마이그레이션: authenticated 역할에 누락된 테이블·시퀀스·함수 권한 일괄 부여
--
-- 배경:
--   "permission denied for table memberships (42501)" 등 GRANT 누락 에러 발견.
--   Phase 3~18 마이그레이션이 RLS 정책은 생성했지만 일부 환경에서 기본 GRANT 가
--   누락된 채 적용됨. 본 마이그레이션은 idempotent — 여러 번 실행해도 안전.
--
-- 효과:
--   - authenticated 역할이 모든 public 테이블에 SELECT/INSERT/UPDATE/DELETE 가능
--   - 실제 행 단위 접근은 RLS 정책이 제어 (이중 방어)
--   - 시퀀스 USAGE + 함수 EXECUTE 도 함께 부여

-- ============================================================
-- 1) 스키마 USAGE
-- ============================================================
GRANT USAGE ON SCHEMA public TO authenticated, anon;

-- ============================================================
-- 2) 모든 기존 테이블에 CRUD 권한
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- 향후 추가될 테이블에도 자동 부여 (이 migration 이후 CREATE TABLE 시점에 적용)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- ============================================================
-- 3) 모든 시퀀스 USAGE (uuid 기본키만 쓰지만 안전 차원)
-- ============================================================
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- ============================================================
-- 4) 모든 함수 EXECUTE (RPC 호출 권한)
-- ============================================================
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated;

-- ============================================================
-- 5) anon (비로그인) 도 최소 권한 — 로그인 페이지 등에서 필요할 수 있음
-- ============================================================
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon;

-- ============================================================
-- 6) 검증 쿼리 (실행 후 결과 확인용 — RAISE NOTICE 로 출력)
-- ============================================================
DO $$
DECLARE
  authenticated_table_count int;
  authenticated_function_count int;
BEGIN
  SELECT count(DISTINCT table_name) INTO authenticated_table_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee = 'authenticated'
    AND privilege_type = 'SELECT';

  SELECT count(*) INTO authenticated_function_count
  FROM information_schema.role_routine_grants
  WHERE routine_schema = 'public'
    AND grantee = 'authenticated'
    AND privilege_type = 'EXECUTE';

  RAISE NOTICE 'authenticated 권한 부여 완료: 테이블 % 개, 함수 % 개',
    authenticated_table_count, authenticated_function_count;
END $$;

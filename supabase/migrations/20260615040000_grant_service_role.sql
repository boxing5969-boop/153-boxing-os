-- ============================================================
-- service_role(Workers API) 쓰기 권한 부여 (버그픽스)
-- MCP apply_migration 으로 만든 신규 테이블이 service_role 에 대해
-- SELECT/INSERT/UPDATE/DELETE GRANT 를 못 받아 "permission denied for table"
-- 로 쓰기가 막혔음(읽기는 에러 무시로 빈 결과처럼 보임). 명시적으로 부여한다.
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.daily_reports,
  public.daily_checklists,
  public.monthly_targets,
  public.member_followups,
  public.pt_passes,
  public.sales_entries,
  public.refund_requests
TO service_role;

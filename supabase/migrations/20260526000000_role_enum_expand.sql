-- ============================================================
-- Phase B-1: 역할(user_role) enum 확장
-- ============================================================
-- 멀티테넌트 SaaS 역할 체계로 확장:
--   기존: super_admin, hq_admin, branch_owner, branch_manager, coach, member
--   추가: owner(조직 소유자), brand_manager(브랜드 관리자),
--         staff(지점 직원), accountant(정산 담당), viewer(조회 전용)
--
-- ※ enum 값은 삭제가 위험하므로 기존 6개는 유지(하위호환).
-- ※ ALTER TYPE ADD VALUE 는 같은 트랜잭션에서 그 값을 사용할 수 없으므로
--   이 마이그레이션은 enum 확장만 단독으로 수행한다.
--   (B-2 헬퍼·B-3 정책에서 신규 값 사용)
-- ============================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'brand_manager';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'staff';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'accountant';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'viewer';

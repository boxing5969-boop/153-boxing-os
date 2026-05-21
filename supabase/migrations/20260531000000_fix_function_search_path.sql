-- ============================================================
-- 함수 search_path 고정 (function_search_path_mutable 해소)
-- ============================================================
-- Supabase security advisor 가 search_path 미고정 함수 6건을 경고.
-- 모두 SECURITY DEFINER 가 아닌 트리거·계산 함수라 위험은 낮으나,
-- search_path 를 명시 고정해 하드닝 권고를 충족한다.
-- 함수 동작은 변하지 않는다 (public 스키마 내 동작).
-- ============================================================

ALTER FUNCTION public.access_logs_immutable() SET search_path = public;
ALTER FUNCTION public.touch_updated_at() SET search_path = public;
ALTER FUNCTION public.touch_branch_plan_presets() SET search_path = public;
ALTER FUNCTION public.touch_branch_expenses() SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.calculate_payroll(text, integer, integer, integer, numeric, integer)
  SET search_path = public;

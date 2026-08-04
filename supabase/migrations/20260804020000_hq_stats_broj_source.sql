-- 본사 지점 현황(get_hq_branch_stats)을 브로제이 명부 기준으로 통일
--
-- 배경: 홈·출입 현황·일일 리포트는 member_snapshots(브로제이 동기화 명부)를 원장으로 쓰는데
--       이 함수만 members/memberships(153OS 자체 테이블)를 세고 있어 숫자가 갈렸다.
--       실측(2026-08-04): 선릉 활성 56(구) vs 151(브로제이), 역삼 만료예정 0(구) vs 17(브로제이).
--
-- 변경점
--  1) active_members : members.status='active' → member_snapshots (만료일 미래 OR 만료일없음+유효/활성)
--  2) expiring_7d    : memberships → member_snapshots.end_date (오늘~+7일)
--  3) unpaid_members : deleted_at IS NULL 필터 추가(소프트 삭제 회원 제외)
--  4) 날짜 기준      : CURRENT_DATE(서버 UTC) → KST 자정 앵커 (오전 9시 전 하루 밀림 제거)
--
-- 영향: 반환 컬럼·타입·순서 동일(계약 불변). 읽기 전용 함수라 데이터 변경 없음.
-- 검증 SQL: 아래 주석 참조.
-- 롤백: 이 파일 하단의 원본 정의를 다시 CREATE OR REPLACE 하면 즉시 복구된다.

CREATE OR REPLACE FUNCTION public.get_hq_branch_stats()
 RETURNS TABLE(branch_id uuid, branch_name text, active_members bigint, today_access bigint, today_denied bigint, expiring_7d bigint, unpaid_members bigint, failed_sync bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH kst AS (
    SELECT
      (now() AT TIME ZONE 'Asia/Seoul')::date AS today,
      ((now() AT TIME ZONE 'Asia/Seoul')::date)::timestamp AT TIME ZONE 'Asia/Seoul' AS day_start
  )
  SELECT
    b.id,
    b.name,
    -- 활성 회원(브로제이 명부 기준)
    (SELECT COUNT(*) FROM member_snapshots s, kst
     WHERE s.branch_id = b.id
       AND (s.end_date >= kst.today
            OR (s.end_date IS NULL AND s.status IN ('유효', '활성')))),
    -- 오늘 출입 성공 (KST 자정 기준)
    (SELECT COUNT(*) FROM access_logs al, kst
     WHERE al.branch_id = b.id AND al.result = 'success'
       AND al.occurred_at >= kst.day_start),
    -- 오늘 출입 거절 (KST 자정 기준)
    (SELECT COUNT(*) FROM access_logs al, kst
     WHERE al.branch_id = b.id AND al.result = 'denied'
       AND al.occurred_at >= kst.day_start),
    -- 7일 내 만료 예정(브로제이 만료일 기준)
    (SELECT COUNT(*) FROM member_snapshots s, kst
     WHERE s.branch_id = b.id
       AND s.end_date >= kst.today
       AND s.end_date <= kst.today + 7),
    -- 미납(브로제이엔 미납 개념이 없어 CRM 수기 처리 기준) — 삭제 회원 제외
    (SELECT COUNT(*) FROM members m
     WHERE m.branch_id = b.id AND m.status = 'unpaid' AND m.deleted_at IS NULL),
    -- 단말기 동기화 실패
    (SELECT COUNT(*) FROM device_sync_jobs dsj
     WHERE dsj.branch_id = b.id AND dsj.status = 'failed')
  FROM branches b
  WHERE b.status = 'active'
  ORDER BY b.name;
$function$;

-- ── 검증 SQL (적용 후 실행해 대조) ────────────────────────────
-- SELECT branch_name, active_members, expiring_7d FROM get_hq_branch_stats();
-- 기대: 선릉 활성 151, 역삼 156, 잠실 122, 칠금 96 (2026-08-04 실측 기준)
--
-- ── 롤백 (원본 정의) ─────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION public.get_hq_branch_stats()
--  RETURNS TABLE(branch_id uuid, branch_name text, active_members bigint, today_access bigint, today_denied bigint, expiring_7d bigint, unpaid_members bigint, failed_sync bigint)
--  LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
--   SELECT b.id, b.name,
--     (SELECT COUNT(*) FROM members m WHERE m.branch_id = b.id AND m.status = 'active'),
--     (SELECT COUNT(*) FROM access_logs al WHERE al.branch_id = b.id AND al.result = 'success' AND al.occurred_at >= CURRENT_DATE::TIMESTAMPTZ),
--     (SELECT COUNT(*) FROM access_logs al WHERE al.branch_id = b.id AND al.result = 'denied' AND al.occurred_at >= CURRENT_DATE::TIMESTAMPTZ),
--     (SELECT COUNT(*) FROM memberships ms WHERE ms.branch_id = b.id AND ms.status = 'active' AND ms.end_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '7 days')),
--     (SELECT COUNT(*) FROM members m WHERE m.branch_id = b.id AND m.status = 'unpaid'),
--     (SELECT COUNT(*) FROM device_sync_jobs dsj WHERE dsj.branch_id = b.id AND dsj.status = 'failed')
--   FROM branches b WHERE b.status = 'active' ORDER BY b.name;
-- $function$;

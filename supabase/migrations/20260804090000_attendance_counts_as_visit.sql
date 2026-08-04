-- 브로제이 출석부와 1:1로 맞추기 — '직원 출근'·'출석 실패'까지 저장하되, 회원 방문 통계는 안 흔들리게.
-- 적용 완료: 2026-08-04 (Supabase tbxdrfowanyksgdicryl)
--
-- ⚠️ 이 파일이 레포에 없으면 db reset·새 환경에서 컬럼이 사라져 출석 동기화(upsert)가 통째로 죽고,
--    함수들이 구버전으로 회귀해 직원 출근이 회원 방문으로 집계된다. 드리프트 방지용으로 반드시 유지한다.
--
-- 배경: 대표님이 브로제이 화면(35건)과 앱(31건)을 대조해 차이를 특정해 주셨다 — 실패 2 + 직원 2.
--       저장은 다 하되 '방문으로 셀지'를 열 하나(counts_as_visit)로 못 박고, 읽는 쪽은 그 열만 본다.

alter table public.attendance_logs
  add column if not exists user_type text,
  add column if not exists fail_reason text,
  add column if not exists counts_as_visit boolean not null default true;

comment on column public.attendance_logs.user_type is '고객 | 직원 — 브로제이 member_type(ADMIN)·attendance_type(GO_TO_WORK) 기준';
comment on column public.attendance_logs.fail_reason is '출석 실패 사유(예: 기간 만료). 만료 회원이 문 앞에서 튕긴 기록 = 재등록 상담 신호';
comment on column public.attendance_logs.counts_as_visit is '회원 방문 통계에 셀 것인가. 고객 AND 성공일 때만 true. 모든 집계는 이 열로 거른다';

-- 기존 행이 전부 고객·성공인 근거: 그 전 동기화는 member_type 기본값 CUSTOMER + 상태 SUCCESS/SHOW 만 받았다.
-- (라이브 실측으로도 9,852행이 SUCCESS/ENTRY 단일 그룹이었다) → default true 가 정확하다. 소급 보정 불필요.

create index if not exists idx_attendance_logs_visit
  on public.attendance_logs (branch_id, attended_at desc)
  where counts_as_visit;

-- 만료로 거절된 출입 = 재등록 상담 대상. 따로 빨리 뽑을 수 있게.
create index if not exists idx_attendance_logs_denied
  on public.attendance_logs (branch_id, attend_date desc)
  where counts_as_visit = false;

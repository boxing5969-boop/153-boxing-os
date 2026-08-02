-- 출석 '깊은 백필'(60일 재수집) 지원 — 2026-08-02
--
-- 왜 필요한가: 매시간 동기화는 최근 3일만 본다. 그 창을 놓친 구간(워커 장애·브로제이 점검·
-- 늦게 등록된 출입)은 영원히 빈 채로 남는다. "지난 토요일 누가 왔나"를 우리 DB로 답하려면
-- 과거가 메워져 있어야 하므로 하루 한 지점씩 60일 창을 다시 훑는다(runBrojAttendanceBackfill).
--
-- ⚠️ kind CHECK 를 넓히지 않으면 logSyncRun 이 조용히 실패한다(코드가 console.error 로만 삼킴).
--    그러면 지점 순번(마지막 시도 시각)이 갱신되지 않아 같은 지점만 매일 반복 백필된다.
alter table broj_sync_runs drop constraint if exists broj_sync_runs_kind_check;
alter table broj_sync_runs add constraint broj_sync_runs_kind_check
  check (kind = any (array['members', 'sales', 'attendance', 'attendance_backfill']));

-- 날짜별 출입 조회(/api/reports/attendance/day)는 attended_at 범위로 자른다.
-- 기존 인덱스는 (branch_id, attend_date) 라서 이 쿼리에는 안 맞는다.
create index if not exists idx_attendance_logs_branch_attended
  on attendance_logs (branch_id, attended_at desc);

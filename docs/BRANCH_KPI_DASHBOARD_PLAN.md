# 153OS — 본사 / 지점 KPI 대시보드 설계

> 본 문서는 [`FRANCHISE_OS_ROADMAP.md`](./FRANCHISE_OS_ROADMAP.md) §4 의 KPI 운영 계획 상세 설계.
> 1차는 **신규 DB 0건** — 기존 테이블 + RPC 집계만으로 구현. 2차는 [`FRANCHISE_DATA_MODEL_PROPOSAL.md`](./FRANCHISE_DATA_MODEL_PROPOSAL.md) 의 `branch_kpis` 캐시 도입 후.

---

## 1. 대시보드 계층

```
┌─────────────────────────────────────────────────────────────┐
│             본사 대시보드 (super_admin / hq_admin)          │
│                                                              │
│  [전사 요약]   [지점 비교]   [추세]   [알림]                │
│      │             │           │         │                  │
│      └─────────────┴───────────┴─────────┘                  │
│                                                              │
│  ─ 회원 (전체 / 활성 / 만료 / 미납 / 체험)                  │
│  ─ 출입 (오늘 성공 / 거절 / 만료 차단 / 미납 차단)          │
│  ─ 매출 (이번 달 / 지난 달 대비, memberships.price 합산)    │
│  ─ 가맹점 오픈 진행 (P3 단계 도입 후)                       │
│  ─ 코치 교육·자격 만료 임박 (P2 도입 후)                    │
│  ─ 장비 가동률 / 미해결 incident (P2 도입 후)               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│   지점 대시보드 (branch_admin / branch_owner / coach 일부) │
│                                                              │
│  ─ 자기 지점만의 KPI                                        │
│  ─ 본사 공지 배너                                           │
│  ─ 오늘의 출입 / 거절 라이브 카운트                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 1차 KPI (신규 DB 없이 구현 가능) — 11종

기존 테이블만 사용. 모두 RPC 집계 또는 PostgREST 집계로 즉시 구현 가능.

| # | KPI | 데이터 출처 | SQL 핵심 | 권한 |
|---|---|---|---|---|
| 1 | 전체 회원 수 | members | `count(*) WHERE branch_id = ...` | 모두 |
| 2 | 활성 회원 수 | members | `count(*) WHERE status='active'` | 모두 |
| 3 | 만료 회원 수 | members | `count(*) WHERE status='expired'` | 모두 |
| 4 | 미납 회원 수 | members | `count(*) WHERE status='unpaid'` | 모두 |
| 5 | 체험권 사용 중 회원 수 | trial_passes | `count(*) WHERE status='active' AND end_at > now() AND used_entries < max_entries` | 모두 |
| 6 | 오늘 출입 수 | access_logs | `count(*) WHERE result='success' AND occurred_at::date = today` | 모두 |
| 7 | 오늘 출입 거절 수 | access_logs | `count(*) WHERE result='denied' AND occurred_at::date = today` | 모두 |
| 8 | 만료로 거절된 출입 수 (30일) | access_logs | `count(*) WHERE denied_reason='expired_membership' AND occurred_at >= now()-30d` | hq, branch_admin |
| 9 | 미납으로 거절된 출입 수 (30일) | access_logs | `count(*) WHERE denied_reason='unpaid' AND occurred_at >= now()-30d` | hq, branch_admin |
| 10 | 지점별 회원 수 (전사 비교) | members + branches | `group by branch_id` | hq only |
| 11 | 지점별 출입 거절 수 (전사 비교) | access_logs + branches | `group by branch_id, result='denied'` | hq only |

### 2.1 RPC 제안 (1차)

```sql
-- 본사·지점 자동 분기
CREATE OR REPLACE FUNCTION get_dashboard_kpi_v1(_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_profile RECORD;
  filter_branches uuid[];
  result jsonb;
BEGIN
  SELECT id, role, company_id, branch_id INTO caller_profile
  FROM profiles WHERE auth_user_id = auth.uid();

  IF caller_profile IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- 본사 권한 = 자사 모든 지점, 지점 권한 = 자기 지점만
  IF caller_profile.role IN ('super_admin','hq_admin') THEN
    SELECT array_agg(b.id) INTO filter_branches
    FROM branches b WHERE b.company_id = caller_profile.company_id;
  ELSIF _branch_id IS NOT NULL AND caller_profile.branch_id = _branch_id THEN
    filter_branches := ARRAY[_branch_id];
  ELSIF caller_profile.branch_id IS NOT NULL THEN
    filter_branches := ARRAY[caller_profile.branch_id];
  ELSE
    RAISE EXCEPTION 'no branch scope';
  END IF;

  -- 1~11 KPI 집계 후 jsonb 로 반환
  SELECT jsonb_build_object(
    'member_total',   (SELECT count(*) FROM members WHERE branch_id = ANY(filter_branches)),
    'member_active',  (SELECT count(*) FROM members WHERE branch_id = ANY(filter_branches) AND status='active'),
    'member_expired', (SELECT count(*) FROM members WHERE branch_id = ANY(filter_branches) AND status='expired'),
    'member_unpaid',  (SELECT count(*) FROM members WHERE branch_id = ANY(filter_branches) AND status='unpaid'),
    'trial_active',   (SELECT count(*) FROM trial_passes
                       WHERE branch_id = ANY(filter_branches)
                         AND status='active' AND end_at > now()
                         AND used_entries < max_entries),
    'access_today_success', (SELECT count(*) FROM access_logs
                       WHERE branch_id = ANY(filter_branches)
                         AND result='success'
                         AND occurred_at::date = current_date),
    'access_today_denied',  (SELECT count(*) FROM access_logs
                       WHERE branch_id = ANY(filter_branches)
                         AND result='denied'
                         AND occurred_at::date = current_date),
    'denied_expired_30d',   (SELECT count(*) FROM access_logs
                       WHERE branch_id = ANY(filter_branches)
                         AND denied_reason='expired_membership'
                         AND occurred_at >= now() - interval '30 days'),
    'denied_unpaid_30d',    (SELECT count(*) FROM access_logs
                       WHERE branch_id = ANY(filter_branches)
                         AND denied_reason='unpaid'
                         AND occurred_at >= now() - interval '30 days')
  ) INTO result;

  RETURN result;
END $$;

GRANT EXECUTE ON FUNCTION get_dashboard_kpi_v1(uuid) TO authenticated;
```

> 이 RPC 는 **마이그레이션 파일 없이** 즉시 SQL Editor 에서 추가 가능. 기존 `dashboard-stats` RPC 가 이미 있는지 먼저 확인하고 (Phase 5 진단 단계) 그것을 보강하는 방식 권장.

### 2.2 지점별 비교 RPC (hq only)

```sql
CREATE OR REPLACE FUNCTION get_branch_comparison_v1()
RETURNS TABLE (
  branch_id uuid, branch_name text,
  member_active int, member_expired int, member_unpaid int,
  access_today_success int, access_today_denied int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  caller_role text; caller_company uuid;
BEGIN
  SELECT role, company_id INTO caller_role, caller_company
  FROM profiles WHERE auth_user_id = auth.uid();
  IF caller_role NOT IN ('super_admin','hq_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT b.id, b.name,
    (SELECT count(*)::int FROM members m WHERE m.branch_id = b.id AND m.status='active'),
    (SELECT count(*)::int FROM members m WHERE m.branch_id = b.id AND m.status='expired'),
    (SELECT count(*)::int FROM members m WHERE m.branch_id = b.id AND m.status='unpaid'),
    (SELECT count(*)::int FROM access_logs a WHERE a.branch_id = b.id
       AND a.result='success' AND a.occurred_at::date = current_date),
    (SELECT count(*)::int FROM access_logs a WHERE a.branch_id = b.id
       AND a.result='denied' AND a.occurred_at::date = current_date)
  FROM branches b
  WHERE b.company_id = caller_company AND b.status = 'active'
  ORDER BY b.name;
END $$;

GRANT EXECUTE ON FUNCTION get_branch_comparison_v1() TO authenticated;
```

---

## 3. 2차 KPI (90일 — 신규 테이블 후) — 8종

| # | KPI | 데이터 출처 | 비고 |
|---|---|---|---|
| 12 | 재등록률 (30일) | memberships | 종료 후 30일 내 새 membership 생성한 회원 % |
| 13 | 체험 전환율 (30일) | trial_passes + memberships | 체험권 종료 후 30일 내 정회원 전환 % |
| 14 | 출석률 (월) | access_logs + memberships | 회원당 평균 출입일 / 가능일 |
| 15 | 코치별 담당 회원 수 | members.assigned_coach_id | profiles join |
| 16 | 코치별 재등록률 | memberships + assigned_coach_id | 코치 평가 핵심 지표 |
| 17 | 무단 출입 시도 (30일) | access_logs | denied_reason='unknown_user' |
| 18 | 코치별 평균 평가 점수 | branch_quality_checks (P2) | category='coach' 평균 |
| 19 | 미해결 incident 수 | equipment_incidents (P2) | status NOT IN ('resolved','closed') |

### 2차 KPI 설계 원칙
- **branch_kpis** 캐시 테이블 도입 — 매일 자정 cron 으로 스냅샷 생성
- 추세 차트 (지난 90일) 는 캐시 row 직접 SELECT — 매번 raw 집계 X
- 13(체험 전환율) 등 복잡 집계는 SECURITY DEFINER RPC `recompute_branch_kpis(_date date)` 로 야간 일괄
- 본사 화면이 캐시를 보면 응답 < 50ms, raw 집계는 > 1초 가능

---

## 4. 권한별 표시 범위

| 역할 | 보이는 범위 | 보이지 않는 것 |
|---|---|---|
| `super_admin` | 전사 + 지점별 비교 + 모든 지점 incident | — |
| `hq_admin` | 자사 company 안의 모든 지점 (1) | 다른 company 데이터 |
| `branch_admin` / `branch_owner` | 자기 branch 만 | 다른 지점·전사 비교 |
| `coach` | 자기 담당 회원 KPI 일부 (#1, #15, #16) | 매출, 미납 회원 명단 |
| `staff` | 자기 지점 운영 KPI (#1~#7) | 회원 개인정보 마스킹 (이름 가운데 글자 *) |

> RLS 가 행 단위 격리, 화면 단의 컴포넌트별 노출은 `useAuth()` 의 `profile.role` 로 분기. 둘 다 적용 (defense in depth).

---

## 5. UI 컴포넌트 계획

### 5.1 본사 대시보드 (1차 — 신규 DB 0)

```
[ 회원 ]                     [ 출입 ]                    [ 미납·만료 압박 ]
─ 전체  N  ─ 활성  N         ─ 오늘 성공 N              ─ 만료 차단 (30일) N
─ 만료  N  ─ 미납  N         ─ 오늘 거절 N              ─ 미납 차단 (30일) N
─ 체험  N                                                ─ 미납 회원 명단 (top10)

[ 지점별 비교 (hq only) — 표 또는 막대 ]
지점명    | 활성  | 만료  | 미납  | 오늘 성공 | 오늘 거절
가양점    | 120   | 8     | 3     | 24        | 1
주안점    | ...

[ 본사 공지 배너 (P2 도입 후) ]
[ 미해결 incident (P2 도입 후) ]
```

### 5.2 지점 대시보드 (1차)

위 본사 화면에서 "지점별 비교" 만 제외. 자기 지점 row 만 표시.

### 5.3 컴포넌트

| 파일 | 역할 | 신규 / 기존 |
|---|---|---|
| `apps/crm/src/pages/DashboardPage.tsx` | 메인 대시보드 진입점 | 기존 (확장) |
| `apps/crm/src/components/dashboard/KpiCard.tsx` | 단일 KPI 표시 | 신규 |
| `apps/crm/src/components/dashboard/KpiGrid.tsx` | 카드 격자 | 신규 |
| `apps/crm/src/components/dashboard/BranchComparisonTable.tsx` | 지점 비교 표 (hq only) | 신규 (P2) |
| `apps/crm/src/services/dashboard.ts` | RPC 호출 | 기존 (확장) |

차트 라이브러리는 1차에서 추가 X — 단순 숫자 + 막대 (Tailwind div 으로 그리기). 추세 차트는 2차에서 검토.

---

## 6. 데이터 흐름

### 1차 (캐시 없음)
```
Frontend useQuery(["dashboard-v1", branchId])
   ↓
supabase.rpc("get_dashboard_kpi_v1", { _branch_id: ... })
   ↓
PostgreSQL — 매번 raw 집계 (수십 ms 예상, 회원 1만명 이내 안전)
```

`staleTime`: 60초 (대시보드는 실시간 아님). 회원 등록·출입 발생 시 자동 invalidate 안 함 — 60초 후 자동 갱신 또는 수동 새로고침.

### 2차 (캐시 도입 후)
```
cron 매일 자정 (Workers)
   ↓
recompute_branch_kpis(_date) — 모든 active 지점에 대해 row INSERT/UPSERT
   ↓
branch_kpis 테이블에 1지점 1일 1row

Frontend useQuery(["dashboard-v2", branchId, dateRange])
   ↓
supabase.from("branch_kpis").select(...).eq("branch_id", ...).gte("snapshot_date", ...)
   ↓
캐시된 row 직접 SELECT (< 50ms)
```

---

## 7. 구현 단계

### Phase 5 (Day 0~30) — 1차 KPI 도입
1. **진단**: 기존 `dashboard-stats` RPC 가 있는지, DashboardPage.tsx 의 현재 구조 확인
2. **마이그레이션 0건** — RPC 만 SQL Editor 추가 (또는 신규 마이그레이션 파일 1개)
3. **frontend** — `services/dashboard.ts` 에 `getDashboardKpi(branchId?)` 추가
4. **컴포넌트** — `KpiCard`, `KpiGrid` 신규
5. **DashboardPage** 가 `useAuth()` 로 role 확인 후 hq 면 비교 표시, 그 외 자기 지점만
6. 검증: typecheck + build + 운영 회원 1만건 환경에서 응답 시간

### Phase 5.5 — 본사 비교 표 (hq only)
1. RPC `get_branch_comparison_v1` 추가
2. `BranchComparisonTable.tsx` 신규
3. 권한 분기: HQ_ROLES.has(profile.role) 일 때만 컴포넌트 마운트

### Phase 5.6 — 알림·실시간성
- **WebSocket / SSE 도입은 보류** — 60초 staleTime 으로 충분. 트래픽 비용 고려.
- 대신 access_logs 의 오늘 카운트만 별도 query 로 30초 staleTime → 출입 라이브 표시

### Phase 8 (Day 31~90) — 2차 KPI 도입
- `branch_kpis` 마이그레이션 + cron + frontend 추세 차트

---

## 8. 위험 요소 / 결정사항

| 항목 | 결정 |
|---|---|
| 회원 1만명 이상 환경에서 raw RPC 성능 | 인덱스(`access_logs(branch_id, occurred_at)` 등)는 이미 있음. 1만명 이내 안전 추정. 초과 시 캐시 도입 |
| 차트 라이브러리 (recharts/chart.js) | 1차 도입 X. 단순 숫자 + Tailwind 막대. 메모리에 학습된 청크 분리 사고 회피 |
| 회원 정보 마스킹 (staff role) | RPC 단에서 처리 — frontend 마스킹은 우회 가능 |
| 지점장이 다른 지점 비교를 보고 싶다고 요청 시 | 거절 — 운영 정책. 본사가 별도 보고서 PDF 제공 |
| 매출 KPI (memberships.price 합산) | 1차는 옵셔널 — `price` NULL 인 row 가 많으면 표시 X. 2차에 정착화 |
| 결제선생 매출 정산 데이터 | 보류 ([`FRANCHISE_OS_ROADMAP.md`](./FRANCHISE_OS_ROADMAP.md) §9 참조) |

---

## 9. 본 문서가 따르는 절대 원칙

1. KPI 집계 SQL 의 권위는 DB SECURITY DEFINER RPC. frontend 에서 raw count 금지.
2. 서버 권한 검증은 RPC 안 SELECT FROM profiles. frontend role 분기는 보조 UX.
3. dashboard query 의 staleTime 은 60초 — access-preview 와 달리 mutation invalidation 없음
4. 차트 라이브러리 추가 시 청크 분리 금지 (forwardRef 사고 회피)
5. service_role key 는 절대 frontend 노출 X
6. 결제·payment 영역과 격리

---

*이 문서는 KPI 대시보드 합의용 설계서다. Phase 5 진단 → 사용자 승인 → 1차 구현 → 운영 검증 → 2차 도입 순으로 진행한다.*

# 05. 개발 로드맵 (Phase 2~8)

> Phase 1 산출물 #7 — Phase 별 입력·산출물·검증 방법
> 작성일: 2026-04-28

---

## 진행 상태 (2026-04-28 기준)

| Phase | 제목 | 상태 |
|---|---|---|
| 0 | 폴더 진단 + git init | ✅ 완료 |
| 1 | 아키텍처 문서 작성 | 🔄 진행중 (본 문서) |
| 2 | 모노레포 scaffold | ⏳ |
| 3 | DB 스키마 + 마이그레이션 | ⏳ |
| 4 | Workers API 골격 | ⏳ |
| 5 | CRM 화면 1차 | ⏳ |
| 6 | 출입권한 자동화 | ⏳ |
| 7 | Mock Device 통합 테스트 | ⏳ |
| 8 | 실제 장비 연동 준비 | ⏳ |

---

## Phase 2 — 모노레포 scaffold

**목표:** 빌드 가능한 빈 모노레포 + lint/format/type 통과.

**입력:** 본 docs/ 폴더 8개 문서.

**산출물:**
- 루트 `package.json` + `pnpm-workspace.yaml` (또는 bun workspaces)
- `apps/crm/` — Vite + React + TS + Tailwind + shadcn/ui 초기 페이지 1장
- `workers/api/` — Hono 기반 hello world Worker + `wrangler.toml`
- `packages/shared/` — 빈 패키지 (types/index.ts, validation/index.ts)
- `packages/device-adapters/` — 인터페이스 + MockDeviceAdapter 스텁 (메서드 throw)
- 루트 `tsconfig.base.json` + 각 패키지 `tsconfig.json`
- 공통 lint: ESLint + Prettier + `tsc --noEmit` 한방 명령
- `.env.example` (값 없음, 키만)
- 루트 `README.md` (간단 시작 가이드)

**검증:**
- `pnpm install` (또는 `bun install`) 성공
- `pnpm -r build` 모든 패키지 빌드 성공
- `pnpm -r typecheck` 통과
- `apps/crm` dev 서버 실행 → `localhost:5173` 빈 페이지 표시
- `wrangler dev` workers/api 실행 → `localhost:8787/health` 200 OK

**커밋:** `feat: Phase 2 — monorepo scaffold (crm + workers + shared + device-adapters)`

**주의:**
- 의존성 버전을 lockfile 까지 첫 커밋에 포함
- shadcn/ui 초기 컴포넌트는 Button 1개만 추가 (이후 필요시 add)

---

## Phase 3 — DB 스키마 + 마이그레이션

**목표:** Supabase 신규 프로젝트에 14개 테이블 + RLS + 헬퍼 함수 + 시드 적용.

**입력:** `docs/01-db-schema.md`.

**산출물:**
- Supabase 신규 프로젝트 생성 (이름: `153-boxing-os` 또는 사용자 결정)
- `supabase/config.toml` (project_id 새로 발급)
- `supabase/migrations/20260428100000_init_enums.sql`
- `supabase/migrations/20260428100100_init_tables.sql`
- `supabase/migrations/20260428100200_init_indexes.sql`
- `supabase/migrations/20260428100300_init_helpers.sql` (has_role, current_branch_id 등)
- `supabase/migrations/20260428100400_init_rls.sql`
- `supabase/migrations/20260428100500_init_audit_triggers.sql`
- `supabase/seed.sql` — 153 본사 1개 + 데모 지점 2개 + 데모 직원 3명 + 데모 회원 5명
- `apps/crm/src/integrations/supabase/types.ts` — `supabase gen types typescript` 결과
- `apps/crm/src/integrations/supabase/client.ts` — 싱글톤
- `.env.example` 업데이트 (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)

**검증:**
- 로컬: `supabase start` + `supabase db reset` 로 마이그레이션·시드 적용
- 원격: `supabase db push` 로 프로덕션 적용
- 권한 테스트 SQL: `branch_owner` 가 다른 지점 회원 SELECT 차단 확인
- `access_logs` UPDATE/DELETE 시도 → 트리거로 거부 확인

**커밋:** `feat: Phase 3 — Supabase schema (14 tables + RLS + audit triggers)`

**주의:**
- 첫 마이그레이션에 모든 ENUM/테이블/인덱스/RLS 를 묶지 않고, 위처럼 분할 → 디버깅 용이
- service role key 절대 클라이언트 코드에 포함 금지 (Workers 만)

---

## Phase 4 — Workers API 골격

**목표:** 출입 4개 엔드포인트가 mock 응답으로 동작 + JWT/HMAC 미들웨어 + Supabase 연결.

**입력:** `docs/02-api-design.md`.

**산출물:**
- `workers/api/src/middleware/jwt.ts` — Supabase JWT 검증
- `workers/api/src/middleware/deviceAuth.ts` — HMAC + replay 방지
- `workers/api/src/lib/supabase.ts` — service role 클라이언트
- `workers/api/src/routes/access.ts` — `/api/access/verify`, `/api/access/qr/generate`
- `workers/api/src/routes/devices.ts` — `/api/devices/sync-member`, `/api/devices/webhook`
- `workers/api/src/routes/admin.ts` — `/api/admin/door/open`
- `workers/api/src/services/accessVerifier.ts` — 출입 판단 로직
- `workers/api/src/services/qrToken.ts` — 발급/검증
- `workers/api/src/services/auditLogger.ts` — access_logs INSERT
- `workers/api/wrangler.toml` — bindings (Supabase URL, service key, KV namespace, secrets)
- `workers/api/test/` — vitest + miniflare 통합 테스트

**검증:**
- 정상 회원: `verify` → `door_open: true`
- 만료 회원: `verify` → `door_open: false`, `expired_membership`
- QR 발급 → 60초 안 사용 → success / 60초 후 → `qr_expired`
- QR 같은 토큰 두 번 사용 → 두 번째 `qr_already_used`
- HMAC 변조 → `INVALID_SIGNATURE`
- timestamp ±60초 밖 → `TIMESTAMP_OUT_OF_RANGE`

**커밋:** `feat: Phase 4 — Workers API (access verify + QR + device webhook + admin door)`

---

## Phase 5 — CRM 화면 1차

**목표:** 본사·지점 직원이 회원·이용권·로그·장비를 관리할 수 있음.

**입력:** Phase 3 DB + Phase 4 API.

**산출물 (페이지):**
- `/login` — Supabase Auth 로그인
- `/` — 대시보드 (오늘 출입 / 거절 / 만료예정 / 동기화 실패 위젯)
- `/members` — 회원 목록 + 검색 + 신규 등록
- `/members/:id` — 회원 상세 (이용권/체험권/출입가능여부/얼굴등록/QR/상담/레벨)
- `/memberships` — 이용권 등록 / 연장 / 정지 / 미납 / 환불
- `/trial-passes` — 체험권 발급 + 사용 내역
- `/access-logs` — 필터 (지점·회원·결과·사유)
- `/devices` — 장비 목록 + 상태 + 강제 동기화 + 마지막 통신
- `/visitors` — 방문/상담 신청 관리
- `/branches` — (본사만) 지점 목록 + 회원 수 + 출입로그
- `/levels` — White/Blue/Red/Black × Lv1~10 진행 입력
- `/settings/profile` — 자기 프로필

**산출물 (UX):**
- 모바일 반응형 (지점 관리자가 태블릿 사용 가정)
- shadcn/ui 컴포넌트 일관 사용
- 한국어 UI

**검증:**
- 데모 데이터 시드로 시나리오 워크: 회원 등록 → 이용권 등록 → 거절 사유 발생 → 로그 조회
- super_admin / branch_owner / coach 각 역할로 로그인 → RLS 가드 확인
- 모바일 (375px) 화면 깨지지 않는지 확인

**커밋 분할 권장:** 페이지별 PR 또는 도메인별 PR (회원 / 이용권 / 로그 / 장비)

**주의:**
- 페이지마다 200줄 이하 (CLAUDE.md L341)
- API 응답 캐시는 React Query 표준 패턴 사용
- 출입 거절 화면은 본사 view 와 지점 view 권한 차이 명확히

---

## Phase 6 — 출입권한 자동화

**목표:** 회원 상태 변경이 자동으로 단말기 동기화 작업으로 이어진다.

**입력:** Phase 4 API + Phase 5 UI.

**산출물:**
- DB 트리거 / Edge Function: `memberships.status` 변경 → `device_sync_jobs` INSERT
- 매일 자정 cron: `memberships WHERE end_date < today` → status='expired' + sync
- 매일 자정 cron: `trial_passes WHERE end_at < now` → status='expired' + sync
- `device_sync_jobs` 처리 cron (1분 또는 30초 간격)
- 실패 알림: `device.status='error'` + 대시보드 위젯
- 관리자 강제 동기화 버튼 (CRM 화면에서)

**검증:**
- 수동: 이용권 만료일을 어제 날짜로 변경 → 1분 내 sync_job 생성 + 단말기 disableUser 호출 (Mock)
- 수동: 이용권 새 등록 → sync_job 생성 + createUser 호출 (Mock)
- 5번 실패 시 device.status='error' 자동 전환 확인

**커밋:** `feat: Phase 6 — automatic access sync (cron + triggers + retry)`

---

## Phase 7 — Mock Device 통합 테스트

**목표:** CLAUDE.md L302-313 의 10개 시나리오 자동화 테스트 통과.

**입력:** Phase 6 자동화 + MockDeviceAdapter 완성.

**산출물:**
- `workers/api/test/scenarios/` — 10개 시나리오 e2e 테스트
- `packages/device-adapters/test/mock.test.ts`
- CI 파이프라인 (GitHub Actions): PR 마다 typecheck + lint + unit + e2e
- 시나리오별 데모 페이지 (옵션) — `/dev/scenarios` 에서 버튼 클릭으로 시뮬레이션

**검증 시나리오 (CLAUDE.md L302-313):**
1. ✅ 정상 회원 face → 입장 성공
2. ✅ 만료 회원 face → 거절 (expired_membership)
3. ✅ 미납 회원 face → 거절 (unpaid)
4. ✅ 체험권 1회 사용 후 재입장 → 거절 (trial_max_used)
5. ✅ QR 만료 후 → 거절 (qr_expired)
6. ✅ QR 캡처 재사용 → 거절 (qr_already_used)
7. ✅ 관리자 원격 오픈 → success 로그 (credential_type=admin)
8. ✅ 단말기 동기화 실패 → 대시보드 표시
9. ✅ 코치 RLS — 담당 회원만 조회
10. ✅ 가맹점주 RLS — 자기 지점만 조회

**커밋:** `feat: Phase 7 — Mock device integration + 10 e2e scenarios`

---

## Phase 8 — 실제 장비 연동 준비

**목표:** Suprema 또는 다른 벤더 계약 후 빠르게 어댑터만 구현하면 운영 가능한 상태.

**입력:** 계약된 벤더 API 명세서.

**산출물:**
- `packages/device-adapters/src/adapters/suprema.ts` 실 구현
- `packages/device-adapters/test/suprema.test.ts` (실 단말기 또는 mock server)
- 운영 가이드: 벤더 등록 절차, API key 발급, 단말기 등록 화면 사용법
- 회원 얼굴등록 워크플로 문서 (단말기 자체 등록 모드 + CRM 매핑)
- 환경변수: `SUPREMA_API_BASE`, `SUPREMA_TENANT_ID` 등

**검증:**
- 실 단말기 1대로 시나리오 1, 2 (정상/만료) 수행
- 회원 100명 등록 시 sync 평균 시간 측정 (목표 < 30초/명)
- 실패 사례 처리 (단말기 오프라인) 시 retry + 알림 동작 확인

**커밋:** `feat: Phase 8 — Suprema adapter (real hardware integration)`

**주의:**
- 실 장비 테스트는 **반드시 별도 지점/장비** 에서 (운영 영향 0 보장)
- Phase 8 완료 후에야 첫 가맹점 베타 운영 시작

---

## 단계 외 상시 작업

| 작업 | 시점 |
|---|---|
| GitHub Actions CI | Phase 2 끝에 활성화 |
| Cloudflare Pages preview | Phase 5 시작 시 |
| 운영 환경 별도 분리 (staging/prod) | Phase 5 끝 |
| Sentry / Logtail (관측) | Phase 5 또는 6 |
| 백업 (DB 일일 스냅샷) | Phase 8 직전 |
| 보안 감사 (RLS 우회 테스트) | Phase 7 끝 + Phase 8 직후 |

---

## 의존 관계 그래프

```
Phase 0 ─┐
         ▼
Phase 1 ──▶ Phase 2 (scaffold)
                  │
                  ├──▶ Phase 3 (DB)
                  │           │
                  │           └──▶ Phase 4 (Workers API)
                  │                       │
                  │                       └──▶ Phase 5 (CRM 화면)
                  │                                   │
                  │                                   └──▶ Phase 6 (자동화)
                  │                                              │
                  └────────────────────────▶ Phase 7 (Mock 통합)─┘
                                                       │
                                                       └──▶ Phase 8 (실 장비)
```

각 Phase 는 이전 Phase 완료 + 빌드 통과 가정. 부분 병렬은 허용하나 PR 분리.

---

**다음 문서:** [06-risks.md](./06-risks.md) — 예상 위험요소

---
name: 153os-dev
description: 153복싱짐의 153-boxing-os 코드베이스(React/TypeScript/Vite/Tailwind/shadcn + Cloudflare Workers/Pages + Supabase Postgres)에서 개발 작업을 할 때 반드시 사용. 153 BOXING OS, CRM, 출입통제, access control, 회원관리, 이용권, 출입권한, 출입로그, 단말기 동기화, 얼굴인식 단말기, QR 출입, 슈프리마/BioStar 연동 같은 키워드 또는 153-boxing-os 폴더 작업이 등장하면 무조건 트리거. Phase 단계별 진행 규율, 출입·보안 절대 금지사항, DB 14테이블 스키마 일관성, 코딩 컨벤션을 강제한다. 단순 정보 질문이 아닌 코드·문서·SQL·API 생성/수정/리팩터링 작업이면 항상 이 스킬을 적용하라. game-fit-quests(랭킹업앱) 작업에는 사용하지 말 것 — 그건 gym-quest-dev 스킬이 담당한다.
---

# 153 BOXING OS 개발 가드

이 스킬은 153복싱짐 전국 프랜차이즈용 CRM + 출입통제 시스템 `153-boxing-os` 작업 시 절대 위반하면 안 되는 규칙을 모은 것이다. 이 시스템은 "만료·미납·미등록 회원은 자동으로 출입 불가"가 핵심 목적이므로, 출입 판단 로직을 잘못 설계하면 실제 출입문이 잘못 열리거나 잘못 막힌다. 그래서 규칙이 빡빡하다.

코드·SQL·API·문서를 만들거나 고치기 전에 아래를 반드시 통과시킨다.

## 0. 작업 환경 기본 정보

- 경로: `C:\Users\82104\Desktop\153-boxing-os`
- 저장소명: `153-boxing-os` / 브랜치 전략: `main` · `develop` · `feature/*`
- 구조: 모노레포 (`apps/crm`, `workers/api`, `packages/shared`, `packages/device-adapters`, `supabase/migrations`, `docs`)
- DB/Auth: Supabase Postgres + Supabase Auth — **CRM 전용 별도 프로젝트**
- 배포: Cloudflare Pages(프런트) + Cloudflare Workers(API)
- 응답 언어: 항상 한국어. 보고 대상은 대표님(이용희 CEO).

### game-fit-quests 와의 경계 (가장 흔한 사고)

`153-boxing-os` 와 `C:\Users\82104\game-fit-quests`(마이복서153 랭킹업앱)는 **완전히 별개 시스템**이다.

- 랭킹업앱 코드는 절대 직접 수정하지 않는다. 연동은 CRM 1차 안정화 후 API로만 한다.
- 두 시스템은 각자 별도 Supabase 프로젝트를 쓴다. 랭킹업앱 ref `raoqefkwdpovwlgbibis` 를 CRM 작업에 쓰지 않는다.
- 랭킹업앱 작업 요청이면 이 스킬이 아니라 `gym-quest-dev` 스킬을 쓴다.

## 1. Phase 규율 — 가장 중요

이 프로젝트는 한 번에 전부 구현하지 않는다. 단계(Phase)별로 진행하며, **사용자가 명시적으로 "Phase N 시작해줘"라고 말하기 전까지는 실제 코드를 절대 수정하지 않는다.**

- 한 번의 작업에서 한 Phase만 진행한다. 다음 Phase는 사용자가 명시적으로 요청할 때만 시작한다.
- 코드·파일·SQL을 수정하기 전에 **반드시 변경할 파일 목록을 먼저 보여주고 승인을 받는다.**
- 파괴적 변경(기존 파일 삭제, DB 구조 변경, 마이그레이션 재작성 등)은 반드시 먼저 제안하고 승인받은 후 진행한다.
- 모르거나 불확실한 부분은 임의로 결정하지 말고 반드시 먼저 질문한다.
- 각 Phase 완료 후 다음 단계로 넘어가기 전에 테스트 방법을 안내한다.

### Phase 목록

- Phase 0: 현재 폴더 진단 (아무것도 수정하지 않음) + Git 초기화 + GitHub 원격 연결
- Phase 1: 아키텍처 문서 작성 (`docs/`)
- Phase 2: 프로젝트 생성 (React + Vite + Tailwind + shadcn/ui)
- Phase 3: DB 스키마 작성 (migrations SQL + seed)
- Phase 4: Cloudflare Workers API 골격
- Phase 5: CRM 화면 1차
- Phase 6: 출입권한 자동화
- Phase 7: Mock Device 연동 테스트
- Phase 8: 실제 장비 연동 준비

작업 요청이 들어왔을 때 사용자가 어느 Phase를 시작하라고 명시했는지 먼저 확인한다. 명시가 없으면 "어떤 Phase를 진행할까요?"라고 묻고, 그 전까지는 설명·제안만 한다.

## 2. 출입·보안 절대 금지사항

다음은 시스템 신뢰성과 직결되는 금지사항이다. 하나라도 위반하면 멈추고 보고한다.

1. **문열림 판단을 프론트엔드에서 하지 않는다.** 출입 가능 여부는 오직 Cloudflare Workers API(`POST /api/access/verify`)에서 판단한다.
2. **얼굴인식 성공만으로 문이 열리는 구조를 만들지 않는다.** 단말기는 "누구인지"만 확인하고, "들어와도 되는지"는 CRM이 `access_grants`·`memberships`·`trial_passes` 상태로 판단한다.
3. **회원앱(랭킹업앱 포함)에서 직접 DB를 수정하게 하지 않는다.** 모든 쓰기는 권한 검증된 서버 API 경유.
4. **`access_logs` 를 수정·삭제 가능한 일반 데이터처럼 만들지 않는다.** 감사 로그이므로 append-only 구조로 설계하고, UPDATE/DELETE 경로를 만들지 않는다. 성공·거절 모든 시도를 기록하고 `denied_reason` 을 명확히 남긴다.
5. **지점 구분 없이 단일 체육관용으로 설계하지 않는다.** 모든 핵심 테이블·쿼리는 `branch_id`(필요 시 `company_id`)를 포함한다.
6. **얼굴 원본사진·얼굴 템플릿을 CRM/DB에 저장하지 않는다.** 생체정보는 단말기·하드웨어에 두고, CRM에는 연결 ID(`vendor_user_id`)와 동의 기록(`consent_records`)만 저장한다. 동의 철회 시 `device_sync_jobs` 에 disable/delete 작업을 생성한다.
7. **만료·미납·정지·휴회·체험권 종료 상태는 출입권한이 자동으로 제거되어야 한다.** 회원권 등록/연장 시 권한 생성, 만료/정지/미납 시 권한 제거 → 둘 다 `device_sync_jobs` 동기화로 이어진다.
8. **device(장비) API 인증을 CRM 사용자 인증과 섞지 않는다.** 장비는 `device_api_key` 또는 HMAC signature 방식, CRM 사용자는 Supabase Auth.
9. 하드웨어는 `AccessDeviceAdapter` 인터페이스로 추상화한다. 슈프리마/BioStar 연동은 처음엔 `MockDeviceAdapter` 로 만들고, 실제 API 정보를 받으면 어댑터만 교체할 수 있게 한다. 벤더 SDK 호출을 비즈니스 로직에 직접 박지 않는다.

### 권한 원칙 (RLS / API 권한 검증)

- super_admin / hq_admin: 전체 지점, branch_owner / branch_manager: 자기 지점만, coach: 담당 회원만, member: 본인만.
- 모든 API는 인증·권한 검사를 한다. 권한 누락 쿼리를 만들지 않는다.

## 3. DB 스키마 일관성

스키마는 `supabase/migrations/` 의 표준 SQL이 정본이다. AWS RDS 이전 가능성을 위해 Supabase 전용 문법 남용을 피하고 표준 SQL 중심으로 작성한다. 테이블·컬럼·enum 값을 임의로 새로 만들지 말고, 아래 14개 테이블 정의를 따른다. 변경이 필요하면 먼저 제안한다.

| # | 테이블 | 핵심 필드 / enum |
|---|--------|------------------|
| 1 | companies | id, name, business_type |
| 2 | branches | id, company_id, name, address, phone, status |
| 3 | profiles | id, auth_user_id, role, company_id, branch_id, name, phone, status |
| 4 | members | status: active/trial/expired/suspended/unpaid/withdrawn · assigned_coach_id |
| 5 | memberships | plan_name, start_date, end_date · payment_status: paid/unpaid/partial/refunded · status: active/expired/paused/canceled |
| 6 | trial_passes | start_at, end_at, max_entries, used_entries · status: active/used/expired/canceled |
| 7 | access_devices | device_type: face_terminal/qr_reader/card_reader/relay/kiosk · vendor: suprema/zkteco/hikvision/custom/other · status: active/inactive/error |
| 8 | device_users | member_id, device_id, vendor_user_id · status: active/disabled/pending_sync/sync_failed |
| 9 | access_grants | grant_type: membership/trial/staff/admin_override · valid_from, valid_until · status: active/expired/revoked/suspended |
| 10 | access_logs (감사·삭제불가) | credential_type: face/qr/card/pin/admin/visitor · result: success/denied/error · denied_reason: expired_membership/unpaid/suspended/no_valid_grant/trial_expired/device_error/unknown_user/outside_allowed_time |
| 11 | device_sync_jobs | job_type: create_user/update_user/disable_user/delete_user/sync_access_group/pull_logs · status: pending/processing/success/failed · retry_count |
| 12 | visitor_requests | purpose: consultation/tour/trial/registration · status: requested/approved/denied/completed |
| 13 | consent_records | consent_type: face_recognition/privacy/marketing/terms · agreed, agreed_at, revoked_at |
| 14 | level_progress | tier: white/blue/red/black · level 1~10 · status: not_started/in_progress/passed/failed |

(추가로 `consultation_notes` 가 상담 메모용으로 존재한다.)

규칙:
- enum 값은 위 목록을 그대로 쓴다. 새 값이 필요하면 추가하기 전에 보고한다.
- 모든 테이블에 `created_at`, 변경되는 테이블에 `updated_at` 을 둔다.
- `access_logs` 는 INSERT만 허용. UPDATE/DELETE용 코드·RLS 정책을 만들지 않는다.
- 외래키·인덱스를 명시한다. `branch_id` 필터가 들어가는 컬럼에 인덱스를 고려한다.

## 4. 코딩 컨벤션

- TypeScript strict mode. `any` 타입 금지 (불가피하면 `unknown` + 좁히기).
- 명명: 컴포넌트 `PascalCase`, 함수·변수 `camelCase`, 상수 `UPPER_SNAKE_CASE`.
- API 응답 형식 통일: `{ success: boolean, data: T, message?: string }`.
- 에러는 반드시 `try/catch` 로 처리하고 적절한 HTTP 상태코드를 반환한다.
- 컴포넌트는 200줄 이하로 유지하고, 길어지면 분리한다.
- 한국어 주석 허용.
- 커밋 메시지 접두사: `feat:` / `fix:` / `refactor:` / `docs:` / `chore:`.
- `main` 에 직접 push 금지 — PR로 머지한다. 새 작업은 `feature/*` 브랜치에서.
- `git add -A` / `git add .` 금지 — 변경 파일을 하나씩 명시적으로 add 한다.
- `.env` 는 절대 커밋하지 않는다. `.env.example` 로 환경변수 목록만 관리한다. 환경은 local / staging / production 분리.

## 5. 작업 시작 전 자가 체크

코드·SQL·문서 작업을 시작하기 전 머릿속으로 빠르게 통과시킨다.

1. 사용자가 "Phase N 시작해줘"라고 명시했는가? 아니면 설명·제안만 한다.
2. 변경할 파일 목록을 먼저 보여주고 승인받았는가?
3. 출입 가능 여부 판단이 프론트가 아니라 Workers API에 있는가?
4. 얼굴인식 성공 외에 CRM 권한(`access_grants` 등) 판단이 들어갔는가?
5. `access_logs` 에 UPDATE/DELETE 경로를 만들지 않았는가?
6. 쿼리·테이블에 `branch_id` 가 빠지지 않았는가?
7. 생체정보(얼굴 원본/템플릿)를 CRM에 저장하려 하지 않는가?
8. enum 값·테이블명이 3절 정의와 일치하는가?
9. `any` 타입, `git add -A`, `main` 직접 push, `.env` 커밋이 끼지 않았는가?
10. 랭킹업앱(`game-fit-quests`) 파일을 건드리려 하지 않는가?

하나라도 걸리면 멈추고 사용자에게 보고한다.

## 6. 응답 톤

- 항상 한국어. 응답은 간결하게, 불필요한 반복 설명 생략.
- 변경 사항은 파일 단위로 요약한다: 어떤 파일 / 무엇이 바뀜 / 왜.
- 추측·불확실은 "[확인 필요]"로 표시하고 임의 결정하지 않는다.
- 보호·승인이 필요한 작업은 "이건 진행 전 승인이 필요합니다"라고 명시적으로 짚는다.

# 153OS - Claude Code 설정 파일

너는 피트니스 프랜차이즈 CRM, 출입통제 시스템, Cloudflare Workers, Cloudflare Pages, PostgreSQL, React, TypeScript, 보안 아키텍처, 슈프리마/BioStar API 연동에 능한 시니어 풀스택 개발자다.

우리는 153복싱짐 전국 프랜차이즈 운영을 위한 자체 CRM + 출입통제 시스템을 만들 것이다.
이 프로젝트의 목표는 단순 회원관리 프로그램이 아니라, "153OS"의 1차 버전이다.

## 핵심 목적
1. 만료회원, 미납회원, 미등록회원은 자동으로 출입이 불가능해야 한다.
2. 얼굴인식은 하드웨어 단말기에서 처리하고, 회원권 판단은 153 CRM이 한다.
3. QR 출입은 보조수단으로 반드시 지원한다.
4. 카드/PIN/관리자 오픈은 비상수단으로 지원한다.
5. 출입 성공/거절 로그는 모두 CRM에 저장한다.
6. 지점이 늘어나도 확장 가능한 전국 프랜차이즈 구조로 설계한다.
7. 월비용을 낮추기 위해 클라우드 얼굴인식 API 과금형이 아니라, 단말기 자체 얼굴인식 + 자체 CRM 권한 동기화 구조로 간다.

## 최종 구조

### 회원 식별 방식
- face: 얼굴인식 단말기
- qr: 랭킹업앱 1회용 QR
- card: 관리자/직원 카드
- pin: 비상 PIN
- admin: 관리자 원격 오픈

### 출입 판단 방식
- 얼굴인식 단말기는 "누구인지"만 확인한다.
- 153 CRM은 "들어와도 되는지"를 판단한다.
- 만료, 미납, 정지, 휴회, 체험권 종료 상태는 자동으로 출입권한이 제거되어야 한다.

### 운영 방식
- CRM에서 회원권이 등록/연장되면 해당 회원의 출입권한이 생성된다.
- CRM에서 회원권이 만료/정지/미납 처리되면 해당 회원의 출입권한이 제거된다.
- 출입권한 변경은 단말기 권한 동기화 작업으로 이어진다.
- 단말기 동기화 실패 시 관리자에게 표시된다.
- 단말기가 문을 열었는지, 거절했는지 모든 기록을 CRM에 남긴다.

## 기술 스택

### Frontend
- React + TypeScript + Vite + Tailwind CSS + shadcn/ui
- 배포: Cloudflare Pages

### API
- Cloudflare Workers

### DB
- PostgreSQL
- 초기: Supabase Postgres 또는 Neon Postgres
- 이후: AWS RDS PostgreSQL로 이전 가능하게 표준 SQL 중심 설계
- DB Connection: Cloudflare Hyperdrive 사용 고려

### Storage
- Cloudflare R2
- 얼굴 원본사진/신분증 등 민감정보는 최소 저장 원칙 적용

### Auth / Permission
- Supabase Auth 또는 자체 Auth 중 장단점 비교 후 제안
- 본사/가맹점/관장/코치/회원 권한 분리
- Row Level Security 또는 서버 API 권한검증 구조 적용

### Development
- Claude Code + Git + GitHub + Wrangler CLI

## 중요 원칙

### 절대 하지 말 것
1. 문열림 판단을 프론트엔드에서 하지 말 것.
2. 회원앱에서 직접 DB를 수정하게 하지 말 것.
3. 얼굴인식 성공만으로 문이 열리는 구조를 만들지 말 것.
4. 출입 로그를 수정/삭제 가능한 일반 데이터처럼 만들지 말 것.
5. 지점 구분 없이 단일 체육관용으로만 설계하지 말 것.
6. 기존 랭킹업앱을 바로 수정하지 말 것.

### 반드시 지킬 것
1. 문열림 판단은 Cloudflare Workers API에서 처리한다.
2. 출입권한은 CRM에서 관리한다.
3. 얼굴인식 단말기는 device_user_id 또는 face_user_id만 CRM과 연결한다.
4. 얼굴 원본/템플릿은 가급적 단말기 또는 하드웨어 시스템에 두고, CRM에는 연결 ID와 동의 기록만 저장한다.
5. 회원권 만료 시 출입권한이 자동 제거되어야 한다.
6. 미납, 정지, 환불, 휴회 상태도 출입 차단되어야 한다.
7. 모든 출입 시도는 성공/거절 모두 access_logs에 저장한다.
8. 거절 사유를 명확히 저장한다.
9. 단말기 동기화 실패를 추적하는 device_sync_jobs 테이블을 둔다.
10. 나중에 슈프리마, 다른 안면인식기, QR 리더기, NFC 리더기를 바꿔도 CRM 구조는 유지되게 추상화한다.

## 권한 구조

### roles
- super_admin: 153 본사 최고관리자
- hq_admin: 본사 관리자
- branch_owner: 가맹점주/관장
- branch_manager: 지점 관리자
- coach: 코치
- member: 회원

### 권한 원칙
- 본사는 전체 지점 확인 가능
- 가맹점주는 자기 지점만 확인 가능
- 코치는 담당 회원만 확인 가능
- 회원은 자기 정보만 확인 가능
- 출입장비 API는 별도 device_api_key 또는 signed request 방식으로 인증

## 핵심 DB 테이블 설계

### 1. companies
- id, name, business_type, created_at

### 2. branches
- id, company_id, name, address, phone, status, created_at

### 3. profiles
- id, auth_user_id, role, company_id, branch_id, name, phone, status, created_at

### 4. members
- id, company_id, branch_id, name, phone, birth_date, gender
- status: active / trial / expired / suspended / unpaid / withdrawn
- assigned_coach_id, created_at, updated_at

### 5. memberships
- id, member_id, branch_id, plan_name, start_date, end_date
- payment_status: paid / unpaid / partial / refunded
- status: active / expired / paused / canceled
- created_at, updated_at

### 6. trial_passes
- id, member_id, branch_id, start_at, end_at, max_entries, used_entries
- status: active / used / expired / canceled
- created_at

### 7. access_devices
- id, branch_id, device_name
- device_type: face_terminal / qr_reader / card_reader / relay / kiosk
- vendor: suprema / zkteco / hikvision / custom / other
- model_name, device_identifier, api_endpoint
- status: active / inactive / error
- last_seen_at, created_at

### 8. device_users
- id, member_id, device_id, vendor_user_id
- face_registered, qr_enabled, card_enabled
- status: active / disabled / pending_sync / sync_failed
- last_synced_at, created_at

### 9. access_grants
- id, member_id, branch_id
- grant_type: membership / trial / staff / admin_override
- valid_from, valid_until
- status: active / expired / revoked / suspended
- reason, created_at, revoked_at

### 10. access_logs (감사 로그 - 삭제 불가)
- id, branch_id, device_id, member_id
- credential_type: face / qr / card / pin / admin / visitor
- result: success / denied / error
- denied_reason: expired_membership / unpaid / suspended / no_valid_grant / trial_expired / device_error / unknown_user / outside_allowed_time
- raw_event_id, occurred_at, created_at

### 11. device_sync_jobs
- id, branch_id, device_id
- job_type: create_user / update_user / disable_user / delete_user / sync_access_group / pull_logs
- target_member_id
- status: pending / processing / success / failed
- error_message, retry_count, created_at, processed_at

### 12. visitor_requests
- id, branch_id, name, phone
- purpose: consultation / tour / trial / registration
- status: requested / approved / denied / completed
- approved_by, visit_at, created_at

### 13. consent_records
- id, member_id
- consent_type: face_recognition / privacy / marketing / terms
- agreed, agreed_at, revoked_at, created_at

### 14. level_progress
- id, member_id
- tier: white / blue / red / black
- level: 1~10
- status: not_started / in_progress / passed / failed
- tested_at, approved_by, created_at

### 15. consultation_notes
- id, member_id, branch_id, coach_id, note, next_followup_at, created_at

## 출입 API 설계 (Cloudflare Workers)

### POST /api/access/verify
목적: QR 리더기, 얼굴인식기, 카드리더기, 관리자 앱에서 출입 요청이 들어오면 출입 가능 여부를 판단한다.

입력: branch_id, device_id, credential_type (face|qr|card|pin|admin|visitor), credential_value, occurred_at

처리 순서:
1. device_id 유효성 확인
2. credential_value로 회원 식별
3. 회원 상태 확인
4. access_grants 확인
5. memberships 확인
6. trial_passes 확인
7. unpaid / suspended / expired 여부 확인
8. 출입 가능하면 result=success 로그 저장
9. 출입 불가면 result=denied 로그 저장
10. 성공이면 door_open=true 반환
11. 실패이면 door_open=false와 denied_reason 반환

성공 응답: { "door_open": true, "member_id": "...", "message": "입장 승인" }
거절 응답: { "door_open": false, "denied_reason": "expired_membership", "message": "이용권이 만료되었습니다." }

### POST /api/access/qr/generate
목적: 랭킹업앱에서 1회용 QR 토큰을 생성한다.
조건: 로그인 회원만 생성 가능, 유효시간 30~60초, 1회 사용 후 폐기, nonce+expires_at+signature 구조로 캡처 공유 방지

### POST /api/devices/sync-member
목적: 회원권 등록/연장/만료/정지 시 단말기 권한을 동기화한다.
처리: 유효회원이면 단말기 사용자 활성화 / 만료·미납·정지면 비활성화 / 실패 시 device_sync_jobs에 기록

### POST /api/devices/webhook
목적: 슈프리마/BioStar 또는 다른 단말기 시스템에서 들어오는 출입 이벤트를 수신한다.
처리: 원본 이벤트 저장 → member_id 매칭 → access_logs 저장 → 필요 시 CRM 상태 업데이트

### POST /api/admin/door/open
목적: 관리자가 원격으로 문을 열 때 사용한다.
조건: 관리자 권한 필수, 사유 입력 필수, access_logs에 admin 방식으로 기록

## 안면인식 단말기 연동 원칙

얼굴인식 엔진은 직접 만들지 않는다. 얼굴인식은 단말기가 처리한다.
CRM은 member_id, device_user_id, face_registered 여부, 동의 여부, sync status, access_logs만 관리한다.
슈프리마/BioStar API 연동은 처음에는 mock adapter로 만든다. 나중에 실제 업체 API 정보를 받으면 adapter만 교체할 수 있게 설계한다.

### 하드웨어 추상화 구조
AccessDeviceAdapter 인터페이스 메서드:
- createUser(member) / updateUser(member) / disableUser(member) / deleteUser(member)
- assignAccessGroup(member, branch) / removeAccessGroup(member, branch)
- pullAccessLogs(device) / openDoor(device)

구현체: SupremaAdapter / MockDeviceAdapter / FutureZktecoAdapter / FutureHikvisionAdapter

## 관리자 CRM 화면

### 1. 로그인

### 2. 대시보드
- 오늘 출입 수
- 오늘 출입 거절 수
- 만료로 거절된 건수
- 미납으로 거절된 건수
- 체험권 사용 현황
- 만료 예정 회원
- 단말기 동기화 실패 건수

### 3. 회원관리
- 검색 / 신규 등록 / 회원 상세
- 이용권 상태 / 출입 가능 여부 / 얼굴등록 여부 / QR 사용 가능 여부
- 상담 메모 / 레벨업 현황

### 4. 이용권관리
- 이용권 등록 / 연장 / 정지 / 미납 처리 / 환불·취소 / 만료 자동 처리

### 5. 체험권관리
- 1회 체험권 발급 / 1일 체험권 발급
- 사용 횟수 제한 / 종료 후 자동 차단

### 6. 출입로그
- 성공/거절 필터 / 회원별 필터 / 지점별 필터 / 거절 사유별 필터
- 엑셀 다운로드는 추후 고려

### 7. 출입장비관리
- 장비 등록 / 장비 상태 / 마지막 통신시간
- 동기화 실패 이력 / 강제 동기화 버튼

### 8. 방문자/상담관리
- 시설견학 신청 / 상담 예약 / 직원 승인 출입 / 상담 결과 기록

### 9. 지점관리
- 지점 목록 / 지점별 회원 수 / 지점별 출입로그
- 지점별 매출·이용권 현황은 추후 확장

### 10. 레벨업관리
- White / Blue / Red / Black / Lv1~Lv10
- 레벨테스트 결과 입력 / 담당 코치 승인

## 랭킹업앱 연동 원칙
- 기존 랭킹업앱 파일을 직접 수정하지 않는다.
- CRM 1차 안정화 후 API 연동 작업을 별도 진행한다.
- 필요한 API: 내 이용권 조회 / 내 QR 생성 / 내 출입로그 조회 / 내 레벨 조회

## 개발 순서 (Phase)
- Phase 0: 현재 폴더 진단 (아무것도 수정하지 않음)
- Phase 1: 아키텍처 문서 작성 (docs/ 폴더)
- Phase 2: 프로젝트 생성 (React + Vite + Tailwind + shadcn/ui)
- Phase 3: DB 스키마 작성 (migrations SQL + seed)
- Phase 4: Cloudflare Workers API 골격
- Phase 5: CRM 화면 1차
- Phase 6: 출입권한 자동화
- Phase 7: Mock Device 연동 테스트
- Phase 8: 실제 장비 연동 준비

개발 원칙: 한 번에 전부 구현하지 말고 반드시 단계별로 진행한다. 각 단계마다 변경 파일 목록, 실행 명령어, 테스트 방법을 설명한다. 파괴적 변경이 필요한 경우 반드시 먼저 제안하고 승인받는다.

## 테스트 시나리오
반드시 아래 테스트를 만든다.
1. 유효회원 얼굴인식 → 출입 성공
2. 만료회원 얼굴인식 → 출입 거절
3. 미납회원 얼굴인식 → 출입 거절
4. 체험권 1회 사용 후 재입장 → 출입 거절
5. QR 토큰 만료 후 스캔 → 출입 거절
6. QR 캡처 재사용 → 출입 거절
7. 관리자 원격 오픈 → 출입 성공 로그 저장
8. 단말기 동기화 실패 → 관리자 대시보드 표시
9. 코치는 담당 회원만 조회 가능
10. 가맹점주는 자기 지점만 조회 가능

## 보안 원칙
- 모든 API는 인증/권한 검사를 한다.
- device API는 device_api_key 또는 HMAC signature 방식으로 보호한다.
- access_logs는 삭제 금지 구조로 설계한다.
- 개인정보와 생체정보는 최소 저장 원칙을 지킨다.
- 얼굴 원본사진은 CRM에 저장하지 않는 것을 기본값으로 한다.
- consent_records에 안면인식 동의 기록을 남긴다.
- 동의 철회 시 device_sync_jobs에 disable/delete 작업을 생성한다.

## 산출물 (Phase 0~1에서 먼저 작성)
코드 구현 전에 아래를 먼저 작성한다.
1. 전체 아키텍처 요약
2. 폴더 구조 제안
3. DB 테이블 설계
4. API 설계
5. 출입 흐름도
6. 하드웨어 연동 방식
7. 개발 순서
8. 예상 위험요소
9. 첫 번째 구현 단계에서 만들 파일 목록

## 코딩 컨벤션
- TypeScript strict mode 사용, any 타입 금지
- 컴포넌트명 PascalCase, 함수·변수명 camelCase, 상수 UPPER_SNAKE_CASE
- API 응답 형식 통일: { success: boolean, data: T, message?: string }
- 에러는 반드시 try/catch로 처리하고 적절한 HTTP 상태코드 반환
- 컴포넌트는 200줄 이하 유지, 길어지면 분리
- 한국어 주석 사용 가능
- 커밋 메시지: feat: / fix: / refactor: / docs: / chore: 접두사 사용

## 확정된 아키텍처 결정사항

### 1. Git 초기화
- Phase 0 안에서 git init + GitHub 원격 저장소 연결까지 함께 진행한다.
- 저장소명: 153-boxing-os
- 브랜치 전략: main / develop / feature/*

### 2. DB 선택 → Supabase Postgres 확정
- 랭킹업앱이 이미 Supabase를 사용 중이므로 동일 인프라를 재활용한다.
- 표준 SQL 중심으로 설계하여 추후 AWS RDS 이전이 가능하게 유지한다.
- CRM용 Supabase 프로젝트는 랭킹업앱과 별도 프로젝트로 생성한다. (DB 분리)

### 3. Auth 선택 → Supabase Auth 확정
- 관리자/코치/가맹점주 등 CRM 사용자 인증은 Supabase Auth를 사용한다.
- 단말기(장비) API 인증은 별도 device_api_key + HMAC signature 방식으로 분리한다.
- 랭킹업앱 회원 계정과 CRM 관리자 계정은 별도 Supabase 프로젝트로 분리 관리한다.

### 4. 랭킹업앱과의 관계 → (b) 별개 시스템, API 연동 확정
- 153-boxing-os는 독립된 CRM + 출입통제 시스템이다.
- 랭킹업앱은 별개 시스템이며, CRM 1차 안정화 후 API로만 연동한다.
- 기존 랭킹업앱 코드는 절대 직접 수정하지 않는다.
- DB는 각자 별도 Supabase 프로젝트를 사용하며, API를 통해서만 데이터를 주고받는다.

### 5. 프로젝트 구조 → 모노레포 확정
```
153-boxing-os/
├── CLAUDE.md
├── apps/
│   └── crm/              # React + Vite CRM 관리자 앱
├── workers/
│   └── api/              # Cloudflare Workers API
├── packages/
│   ├── shared/           # 공통 TypeScript 타입, 유틸
│   └── device-adapters/  # 하드웨어 추상화 어댑터
├── supabase/
│   └── migrations/       # DB 마이그레이션 SQL
└── docs/                 # 아키텍처 문서
```

### 6. 호스팅 아키텍처 → Cloudflare Workers 유지 확정
- API 백엔드는 Cloudflare Workers에 둔다. 고정 IP 확보를 위한 전용 서버 이전이나 중계 서버 추가는 하지 않는다.
- 근거: Workers는 자동 확장·무(無)서버관리·고가용성으로 수십~수백 매장 SaaS에 적합하다. 전통 서버로 옮기면 서버 관리·확장 설정·이중화·보안 패치 부담을 떠안게 되어 작은 팀 운영에 불리하다.
- Workers의 구조적 제약(반드시 인지): ① outbound 고정 IP가 없다 ② 요청당 CPU 시간 제한이 있다.

### 7. 외부 서비스 연동 원칙
- 외부 API를 연동할 때는 **IP 화이트리스트가 필요 없는** 서비스만 채택한다. 인증은 API 키 또는 HMAC 서명 방식이어야 한다. (Workers는 발신 IP가 고정되지 않기 때문.)
- IP 등록(발송 서버 IP 화이트리스트)을 요구하는 서비스는 채택하지 않는다. 고정 IP 중계 서버를 두는 우회책도 금지한다 — 전 매장 공용 단일 장애점이 되기 때문이다.

### 8. 문자(SMS/LMS/MMS) 발송
- 문자 발송사는 IP 화이트리스트가 없는 곳을 사용한다 — NCP SENS(권장, 정액 단가) 또는 Solapi.
- 알리고(Aligo)는 발송 서버 IP 등록을 요구하여 Cloudflare Workers와 부적합하므로 사용하지 않는다.
- 대량 발송·일괄 처리는 한 요청에 몰지 않고 크론 + 분할 처리한다 (요청당 CPU 제한 때문). 현재의 크론 + 디스패처 구조를 유지한다.

### 9. 확장 로드맵 — 성장 시 점검 (지금은 불필요)
- 진짜 확장 병목은 Workers가 아니라 DB(Supabase Postgres)의 동시 연결 수다.
- 매장 수가 수십 개를 넘어서는 시점에 점검·업그레이드할 것: Supabase 연결 풀러 또는 Cloudflare Hyperdrive 도입, RLS 정책 효율, 인덱스, 필요 시 읽기 복제본.
- 현재 단계에서는 도입하지 않는다. 성장 단계에서 검토 후 업그레이드한다.

## Phase 1 문자 정책 (확정 2026-05-23)
이 정책은 결정 6~9번의 운영 단계를 명확히 한다.

**Phase 1 (현재) — 라이브 발송 경로**
- 문자(SMS/LMS/MMS) 라이브 발송은 **Solapi 또는 NHN Cloud**만 사용한다.
- 알리고(Aligo)는 **disabled/legacy provider**다. main의 라이브 경로에서 호출되지 않게 한다.
- main 브랜치는 항상 "Workers + Solapi/NHN Cloud" 상태를 유지한다. Solapi → 알리고 전환 커밋(`46e49f2`)은 revert로 롤백되어 있어야 한다.

**Phase 2 (보류) — 알리고 + 고정 IP 게이트웨이**
- 알리고를 라이브로 쓰기 위한 Cloud Run billing-proxy / Cloud NAT / 고정 IP 중계서버 작업은 main에 반영하지 않는다.
- 관련 작업 브랜치(`claude/phase-20a~f` 시리즈)는 `archive/aligo-static-ip-gateway-phase2` 브랜치로 보관한다.
- Phase 2 재개 조건: 매장 수가 충분히 많아져 알리고 단가 절감이 게이트웨이 운영비를 상회하고, HA 구성을 안정적으로 운영할 인력·예산이 확보되었을 때.

**금지**
- 알리고를 main의 라이브 provider로 설정하지 않는다 (`MESSAGE_PROVIDER=aligo` 금지, `ALIGO_ENABLED=true` 금지).
- Cloud Run / Cloud NAT / 고정 IP 인프라를 main에서 새로 배포·구성하지 않는다.
- 프론트엔드에서 알리고를 라이브 발송 옵션처럼 노출하지 않는다.

**재사용 가능 추상화 — Phase 2 재평가용 (현재 Phase 1엔 끌어오지 않음)**
- message provider interface (Phase 20E `apps/billing-proxy/src/providers/types.ts`)
- `message_logs` 테이블 (Phase 20 B2B messaging layer migration)
- idempotency 구조, 발신번호 저장 구조
- → Phase 2 재개 시 위 추상화 재활용 가능성 검토 후 끌어온다.

## 환경 분리 원칙
- local: 로컬 개발 (Neon/Supabase 개발 DB)
- staging: 테스트 배포 환경
- production: 실서비스 환경
- 모든 민감 정보는 .env로 관리, .env는 절대 Git에 커밋하지 않는다.
- .env.example 파일로 필요한 환경변수 목록만 관리한다.

## Git 브랜치 전략
- main: 프로덕션 배포 브랜치
- develop: 개발 통합 브랜치
- feature/기능명: 기능 개발 브랜치
- hotfix/이슈명: 긴급 수정 브랜치
- 직접 main에 push 금지, PR을 통해 머지한다.

---

## [Claude 응답 원칙]
- **항상 한국어로 설명한다.**
- **한 번에 한 Phase만 진행한다.** 다음 Phase는 내가 명시적으로 요청할 때만 시작한다.
- **코드나 파일을 수정하기 전에 반드시 변경할 파일 목록을 먼저 보여주고 승인을 받는다.**
- **"Phase N 시작해줘"라고 말하기 전까지는 실제 코드를 절대 수정하지 않는다.**
- **파괴적 변경(기존 파일 삭제, DB 구조 변경 등)은 반드시 먼저 제안하고 승인받은 후 진행한다.**
- **각 Phase 완료 후 다음 단계로 넘어가기 전에 테스트 방법을 안내한다.**
- **모르거나 불확실한 부분은 임의로 결정하지 말고 반드시 먼저 질문한다.**
- **응답은 간결하게. 불필요한 반복 설명은 생략한다.**

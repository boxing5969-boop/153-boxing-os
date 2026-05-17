# 153OS — 전국 프랜차이즈 운영 OS 로드맵

> 본 문서는 153복싱짐 자체 SaaS "153 BOXING OS" 의 제품 정의·전략·30/90/180일 단계 계획을 담는다.
> 데이터 모델 상세는 [`FRANCHISE_DATA_MODEL_PROPOSAL.md`](./FRANCHISE_DATA_MODEL_PROPOSAL.md), KPI 정의는 [`BRANCH_KPI_DASHBOARD_PLAN.md`](./BRANCH_KPI_DASHBOARD_PLAN.md) 참조.

---

## 1. 153OS 최종 제품 정의

153OS = **CRM + 출입통제 + 회원권 관리 + 지점관리 + 가맹점 운영 + 코치관리 + 랭킹업앱 연동 + 결제·청구 자동화** 가 하나로 묶인 단일 SaaS.

```
┌──────────────────────────────────────────────────────────────────┐
│                          153OS 본사 OS                           │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐     │
│  │  CRM     │  │ 출입통제 │  │ 회원권   │  │ 결제·청구    │     │
│  │ (회원관리)│  │  Core    │  │ 만료/연장│  │ (보류)       │     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘     │
│       │             │             │                │             │
│  ┌────┴─────────────┴─────────────┴────────────────┴───────┐    │
│  │              본사 운영 대시보드 (KPI / 알림)             │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌────────────────────────────┐    ┌─────────────────────────┐ │
│  │  가맹점 온보딩 / 계약 관리 │    │  코치 교육·인증·평가   │ │
│  └────────────────────────────┘    └─────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────┐    ┌─────────────────────────┐ │
│  │  장비 설치·장애 관리       │    │  랭킹업앱 연동(QR/회원) │ │
│  └────────────────────────────┘    └─────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**3-tier 책임 분리** — 절대 원칙:

| Tier | 책임 | 위치 |
|---|---|---|
| **권위 판단** | 문열림 / 출입 가능 여부 / 결제 완료 / 권한 검증 | Cloudflare Workers API + DB RPC (SECURITY DEFINER) |
| **표시·UX** | CRM 화면, 키오스크, 모바일 앱(RankingUp) | Vite/React, RN(랭킹업) |
| **하드웨어** | 얼굴인식 / 카드 / PIN 입력 받기, 누구인지 식별만 | 슈프리마/BioStar 등 단말기 |

> 단말기는 "**누구인지**"만 확인. 153OS Workers 가 "**들어와도 되는지**"를 판단. 이 분리가 깨지면 보안·과금·확장성 모두 깨진다.

---

## 2. 전국 프랜차이즈 운영 목표 (왜 OS 인가)

| # | 목표 | 현재 단일 체육관과 차이 |
|---|---|---|
| 1 | 본사가 모든 지점의 회원·매출·출입을 한 화면에서 본다 | 지점별 따로 관리 → 전국 통합 본사 대시보드 |
| 2 | 가맹점이 늘어도 시스템·운영 비용이 선형 증가하지 않는다 | 가맹점 N개 = 단순 멀티테넌트 (RLS + company_id 격리) |
| 3 | 본사 정책(회원권 정책 변경, 가격 인상, 알림톡 템플릿) 이 모든 지점에 일괄 반영 | 지점 SOP 문서 배포 → 운영 매뉴얼·공지 테이블 |
| 4 | 만료·미납 회원이 자동으로 출입 차단되어 미납 회수 부담 0 | 코치가 수동 차단 → cron + Workers verifyAccess 자동화 |
| 5 | 가맹점 오픈 절차가 표준화·체크리스트화 | 매번 즉흥 설치 → 온보딩 task 추적 |
| 6 | 코치 교육 이수·자격 갱신이 본사에서 관리됨 | 종이 자격증 → coach_certifications 테이블 |
| 7 | 장비 설치·고장이 본사에서 보임 | 지점장이 카톡으로 보고 → 장애 티켓 시스템 |
| 8 | 랭킹업앱 회원 = 153OS 회원 = 단일 신원 | 별도 가입·매핑 수동 → ranking_app_user_id 일관 |

→ **단순 CRM 이 아니라 본사가 가맹점을 표준 운영하는 SaaS 플랫폼**.

---

## 3. 출입통제 Core 의 역할

153OS 의 가장 보안·운영 민감 영역. 이미 1차 안정화된 핵심 자산:

```
[단말기 (face/qr/card/pin)] ──► POST /api/access/verify (HMAC)
                                       │
                                       ▼
                                  verifyAccess()
                                       │
                            ┌──────────┴──────────┐
                            ▼                     ▼
                    previewAccessForMember   credential 분기
                    (member 상태 →           (face/qr/card/pin)
                     access_grants →
                     memberships →
                     trial_passes)
                            │
                            ▼
                  { door_open, reason, source }
                            │
                            ▼
                       access_logs (감사)
```

### Core 가 담당하는 것
- 실시간 문열림 결정 (단말기 응답 < 500ms 목표)
- 만료·미납·정지·체험권 종료 → 자동 거절
- access_grants (특별 권한) — 직원·VIP·임시 출입
- QR 토큰 (60초 TTL, nonce 1회용)
- 비상 PIN (해시 검증 + 사용 카운트)
- access_logs 감사 (UPDATE/DELETE 트리거 차단)

### Core 가 담당하지 않는 것
- 단말기 자체의 얼굴인식 매칭 (벤더 책임 — 슈프리마/BioStar 등)
- 회원의 얼굴 원본 사진 저장 (벤더 단말기 또는 별도 R2, **CRM DB 에는 vendor_user_id 만**)
- 결제 처리 (별도 Payment 모듈, 보류)

### 1차 → 2차 진화 항목
| 항목 | 1차 (현재) | 2차 (90일 내) |
|---|---|---|
| frontend 표시 | preview API 호출 | preview + WebSocket 라이브 갱신 |
| access_grants | DB 직접 RLS | Workers API + 권한 가드 (Phase 6) |
| 단말기 동기화 | 큐(device_sync_jobs) 만 | 실패 알림 + 재시도 정책 자동화 |
| 단말기 어댑터 | 코드 분기만 | 슈프리마/BioStar 정식 어댑터 패키지 |

---

## 4. 지점 KPI 대시보드 설계 — 요약

상세는 [`BRANCH_KPI_DASHBOARD_PLAN.md`](./BRANCH_KPI_DASHBOARD_PLAN.md) 참조. 핵심 KPI 11종을 두 단계로 나눈다.

| 단계 | 새 DB 필요? | KPI 수 | 예시 |
|---|---|---|---|
| **1차** | 없음 (기존 테이블만) | 11 | 활성/만료/미납 회원 수, 오늘 출입 수, 만료 차단 건수 |
| **2차** | branch_kpis 등 신규 | +8 | 재등록률, 체험 전환율, 코치별 담당/재등록률, 무단 출입 시도 건수 |

본사·지점 권한별 노출 범위 분리:
- **super_admin / hq_admin** — 전사 + 지점별 비교
- **branch_admin / branch_owner** — 자기 지점만
- **coach** — 자기 담당 회원 KPI 만
- **staff** — 자기 지점 운영 KPI (회원 정보 마스킹)

---

## 5. 가맹점 온보딩 체크리스트 — 요약

상세는 [`FRANCHISE_DATA_MODEL_PROPOSAL.md`](./FRANCHISE_DATA_MODEL_PROPOSAL.md) §3 참조. 11단계:

```
계약 체결 → 사업자등록 확인 → 인테리어 완료 → 간판 설치
→ 출입장비 설치 → QR/얼굴인식 테스트 → 코치 교육 완료
→ 운영 매뉴얼 숙지 → 알림톡 템플릿 발송 검증 → 오픈 전 본사 점검
→ 본사 최종 승인 → 정식 오픈
```

각 task 는 `branch_onboarding_tasks` 에 row 1개. 담당자·기한·완료 사진/문서·승인자 추적.

---

## 6. 코치 교육·인증 관리

### 데이터 모델
- `coach_certifications` — 1코치 N자격 (생활체육지도사, 153 자체 인증, 응급처치 등)
- `coach_education_records` — 본사 정기 교육 이수 기록 (입문 / 보수 / 안전)
- `coach_quality_checks` — 분기별 본사 평가 (회원 만족도 + 재등록률 + 출석률)

### 운영 흐름
```
가맹점 오픈 60일 내 → 코치 1인당 입문 교육 의무 (본사 진행)
   ↓
1년 1회 보수 교육 (오프라인 또는 온라인)
   ↓
분기별 자체 평가 → 미달 시 본사 알림 + 재교육 권고
   ↓
2년 미이수 → 출입 권한 자동 회수 (자격 정지)
```

### CRM 화면
- 코치 상세 페이지에 자격 카드 (만료일 30일 남음 경고)
- 본사 대시보드: "이번 분기 보수 교육 미이수 코치 N명"
- 가맹점 오픈 대시보드: "교육 미완료 코치 보유 지점 N개"

---

## 7. 장비 설치·장애 관리

### 데이터 모델
- `branch_equipment_installations` — 지점별 설치 장비 인벤토리 (단말기·카드리더·POS·CCTV)
- `equipment_incidents` — 장애 티켓 (보고자·증상·심각도·해결 상태·SLA)

### 자동화
- `access_devices.last_seen_at` 이 5분 이상 끊김 → `equipment_incidents` 자동 생성 (severity = warning)
- 30분 이상 끊김 → severity = critical + 알림톡 자동 발송 (지점장 + 본사)
- `device_sync_jobs` 의 retry_count >= 3 → 동일

### 본사 화면
- "지금 끊긴 단말기" 실시간 카드
- 지점별 장비 가동률 (지난 30일)
- 평균 복구 시간 (MTTR) by 지점
- 장비 모델별 고장률 (벤더 협상 데이터)

---

## 8. 랭킹업앱 연동 계획

### 현재 상태
- `members.ranking_app_user_id` 컬럼 + `LinkRankingAppDialog` 로 수동 매핑
- 출입 시 QR 토큰은 153OS Workers 가 발급 (`POST /api/access/qr/generate`, 60초 TTL)

### 1단계 (30일 내)
- 랭킹업앱이 153OS API 호출 → 자기 ID 로 QR 토큰 발급
- 토큰 받은 앱이 단말기에 보여주면 단말기 → Workers verify → 입장
- 토큰 단방향 (앱 → CRM 회원 매핑 검증)

### 2단계 (90일 내)
- 랭킹업앱 회원가입 시 153OS auth.users 자동 생성 (또는 SSO)
- 출입 이력이 랭킹업앱 "운동 일지" 에 자동 기록
- 153OS 의 회원권 만료 임박 → 랭킹업앱 푸시 알림

### 3단계 (180일 내)
- 랭킹업앱의 게임 결과(레벨, 챌린지 완수)가 153OS 의 코치 평가 화면에 표시
- 본사가 "전국 회원 중 우리 회원 ranking" 노출

### 분리 원칙
- game-fit-quests 코드는 별도 프로젝트, 153-boxing-os 는 **API 계약**만 정의
- 153OS Workers 가 권위. 랭킹업앱은 호출자.
- service_role key 는 절대 랭킹업앱에 들어가지 않는다 — 공개 API + JWT 만.

---

## 9. 결제선생 연동 보류 조건

8개 충족 전까지 **main 영구 보류**. 코드는 `feature/payment-requests` 브랜치에 격리됨 (현재 main 0건).

| # | 조건 | 상태 |
|---|---|---|
| 1 | 결제선생 파트너 계약 완료 | 미완 |
| 2 | 공식 API 문서 확보 | 미완 |
| 3 | `PAYSSAM_API_KEY` 발급 (운영) | 미완 |
| 4 | `PAYSSAM_WEBHOOK_SECRET` 발급 | 미완 |
| 5 | webhook HMAC 검증 구현 (현재는 TODO) | 미완 |
| 6 | `payment_requests` 마이그레이션 운영 DB 적용 | 미완 |
| 7 | 테스트 회원 1명으로 청구서 발송 성공 (E2E) | 미완 |
| 8 | 결제 완료 webhook 으로 paid 전환 성공 (E2E) | 미완 |

→ 8/8 충족 전엔 어떤 결제 코드도 main 머지·배포·시크릿 등록 금지.

대안 (보류 동안):
- 미납 회원 알림톡 발송 (D-7/D-3/D-1) — 이미 운영 중
- 수기 청구 (지점장이 카톡·전화로 처리) — 현재 방식
- "이용권 정지" 만으로도 출입 차단 자동 동작 — 결제 회수 압박 충분

---

## 10. 30 / 90 / 180일 개발 로드맵

### Day 0~30 (P0 안정화 + P1 출입통제 완성)

**완료 또는 진행 중 (이번 세션 결과물)**:
- [x] Cloudflare Pages 빌드 4건 픽스
- [x] Auth profile 로딩 hotfix (상태머신 + retry + stale-request guard)
- [x] access preview API + frontend 통합
- [x] ProtectedRoute idle 무한 로딩 hotfix (Phase 1)
- [x] 회원 상세 출입 카드 UX 고도화 (Phase 2)
- [x] access-preview 캐시 무효화 (Phase 3)

**남은 30일 작업**:
- [ ] **P0 — main push 승인** + Cloudflare Pages 운영 반영 (사용자 결정 대기)
- [ ] **Phase 21 GRANT 마이그레이션** 운영 적용 검증 (`information_schema.role_table_grants` 쿼리)
- [ ] **본사 KPI 대시보드 1차** (Phase 5, 신규 테이블 0)
- [ ] **access_grants 관리 UI** (Phase 6) — 회원 상세에서 임시 권한 발급/회수
- [ ] **Workers typecheck 부채 정리** (사용자 의향 재확인 후) — onboarding.ts/responses.ts
- [ ] **운영 모니터링** — `[fetchProfile]`, `[scheduled:*]` 로그가 Cloudflare Workers Logpush 또는 Sentry 로 가는지 확인

### Day 31~90 (P2 본사 OS + P3 가맹점 온보딩)

**P2 — 본사 운영 OS**:
- 본사 대시보드 v2 (지점간 비교, 추세 차트, 알림 위젯)
- 코치 교육·인증 관리 화면 + `coach_certifications` 마이그레이션
- 장비 가동률 대시보드 + `equipment_incidents` 자동 생성 cron
- 본사 공지 시스템 + `franchise_notices` 마이그레이션 (지점장에게 알림톡)
- 운영 매뉴얼 시스템 + `operating_manuals` 버전 관리

**P3 — 가맹점 온보딩**:
- `branch_onboarding_tasks` 마이그레이션 (11단계 task 템플릿)
- 신규 가맹점 등록 → task 자동 생성 (`provision_new_company` RPC 확장)
- 본사 화면: 오픈 진행률 칸반 보드
- 각 task 완료 시 사진/문서 R2 업로드 + 본사 승인 플로우

**P3.5 — 코드 품질**:
- Supabase Database 타입 자동 생성 (`supabase gen types typescript`)
- `services/branches.ts` 등의 `as unknown as Record<string, unknown>` 단언 일괄 제거
- `noUnusedLocals: true` 활성화 + `accessVerifier.ts` 의 dead interface 정리
- Wrangler 3 → 4 업그레이드

### Day 91~180 (P4 랭킹업 연동 + P5 결제 자동화 + P6 장비 어댑터)

**P4 — 랭킹업앱 연동**:
- 양방향 회원 매핑 (가입 시 자동 link 또는 SSO)
- 153OS 출입 이력 → 랭킹업앱 운동 일지
- 153OS 만료 임박 → 랭킹업앱 푸시 (이용권 갱신 유도)

**P5 — 결제·청구 자동화** (8개 조건 충족 시):
- 결제선생 정식 연동 (8개 조건 모두 충족 시 main 머지)
- 미납 D-7/D-3/D-1 자동 청구서 발송 cron
- 결제 완료 webhook → 회원 status 자동 정상화

**P6 — 장비 정식 어댑터**:
- `packages/device-adapters/` 안에 슈프리마·BioStar·기타 벤더 어댑터 정식 구현 (계약 후)
- 단말기 등록 화면에서 벤더 선택 시 어댑터 자동 매핑
- 단말기 일괄 사용자 동기화 (회원권 갱신 시 1회 push)

### 비상 / 보류

| 항목 | 트리거 |
|---|---|
| 결제선생 파트너 계약 무산 | 자체 결제 시스템 또는 다른 PG (NICE/이니시스 등) 검토 |
| 슈프리마 협력 무산 | 다른 벤더 (Suprema → BioStar 외 → 자체 IoT) 검토 |
| 운영 DB Supabase → 자체 호스트 이전 필요 시 | RLS 정책 그대로 이식 + Cloudflare Hyperdrive |

---

## 부록 — 작업 분기 / 머지 규칙

| 브랜치 | 용도 | 머지 정책 |
|---|---|---|
| `main` | 운영 단일 브랜치 (Cloudflare Pages 자동 배포) | 사용자 명시 승인 후에만 push |
| `feature/access-control-core` | 출입통제 코어 작업 (현재 P0~P3 모두 main 으로 흡수됨) | 신규 출입통제 작업 시 재사용 |
| `feature/payment-requests` | 결제선생 보류 작업 (격리) | 8개 조건 충족 전까지 main 금지 |
| `hotfix/*` | 운영 긴급 픽스 (단일 파일) | 빠른 머지 가능, 단 사용자 승인 |

원칙:
- `git add -A` 금지
- payment 파일은 access-control 작업 시 절대 포함 금지
- main 직접 push 는 사용자 명시 승인 후
- 외부 vendor API 추측 구현 금지 — 계약·문서 후

---

*이 문서는 153OS 의 제품 정의 단일 진입점이다. 신규 합류 LLM·개발자는 이 문서 → 데이터 모델 → KPI 순으로 읽을 것.*

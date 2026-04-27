# 00. 전체 아키텍처 개요

> Phase 1 산출물 #1, #2 — 아키텍처 요약 + 폴더 구조
> 최초 작성: 2026-04-28 (Phase 1)

---

## 1. 시스템 목적

**153 BOXING OS** 는 153복싱짐 전국 프랜차이즈 운영을 위한 **자체 CRM + 출입통제 통합 플랫폼**.

기존 *랭킹업앱* (`game-fit-quests`) 은 회원이 사용하는 모바일 B2C 앱이고, 153 BOXING OS 는 본사·지점이 사용하는 운영 플랫폼이다. 두 시스템은 **완전히 분리**되어 있고, 향후 API 로만 연동한다.

핵심 가치:
1. 만료/미납/미등록 회원을 **자동 출입 차단**
2. 얼굴인식은 단말기가, **회원권 판단은 CRM 이** 담당 (책임 분리)
3. **클라우드 얼굴인식 API 과금 회피** — 단말기 자체 인식 + CRM 권한 동기화 구조
4. **전국 프랜차이즈 확장 가능** — 본사/가맹점/관장/코치 권한 분리

---

## 2. 책임 모델 (한 줄 요약)

```
[단말기]      "이 사람이 누구인지" 만 판단 (얼굴/카드/PIN)
[CRM API]    "이 사람이 들어와도 되는지" 판단 (회원권/미납/정지)
[CRM 화면]    회원권·이용권·출입로그·장비 운영
[랭킹업앱]    회원 모바일 (별개 시스템, API 로만 연동)
```

---

## 3. 시스템 컴포넌트

| 컴포넌트 | 역할 | 기술 |
|---|---|---|
| **CRM Frontend** | 본사·지점 직원 관리 화면 | React + Vite + TS + Tailwind + shadcn/ui → Cloudflare Pages |
| **Workers API** | 출입 판단 / QR 발급 / 단말기 동기화 / 웹훅 수신 | Cloudflare Workers (TypeScript, Hono 또는 itty-router) |
| **Postgres DB** | 회원·이용권·출입권한·로그·동의·동기화 작업 | Supabase Postgres (별도 프로젝트, 랭킹업앱과 분리) |
| **Auth** | 직원·관리자·코치 인증 | Supabase Auth (RLS 기반 권한) |
| **Device API** | 단말기 ↔ Workers 인증 | `device_api_key` + HMAC signature |
| **R2 Storage** | 첨부파일 (회원 사진, 신분증 등 — 최소 저장) | Cloudflare R2 |
| **Device Adapter** | Suprema/BioStar/ZKTeco/Mock 추상화 | TypeScript 인터페이스 + 구현체 |

---

## 4. 모노레포 폴더 구조

```
153-boxing-os/
├── apps/
│   └── crm/                          # CRM 화면 (React + Vite)
│       ├── src/
│       │   ├── pages/
│       │   ├── components/
│       │   ├── hooks/
│       │   ├── lib/
│       │   └── integrations/supabase/
│       ├── public/
│       └── package.json
│
├── workers/
│   └── api/                          # Cloudflare Workers (출입 API)
│       ├── src/
│       │   ├── routes/
│       │   │   ├── access.ts         # /api/access/verify, /api/access/qr/*
│       │   │   ├── devices.ts        # /api/devices/sync-member, /api/devices/webhook
│       │   │   └── admin.ts          # /api/admin/door/open
│       │   ├── middleware/
│       │   │   ├── auth.ts           # Supabase JWT 검증
│       │   │   └── deviceAuth.ts     # device_api_key + HMAC
│       │   └── index.ts
│       ├── wrangler.toml
│       └── package.json
│
├── packages/
│   ├── shared/                       # 공통 타입/유틸 (CRM ↔ Workers 공유)
│   │   ├── src/
│   │   │   ├── types/                # DB 타입, API 응답 타입, ENUM
│   │   │   ├── constants/            # 거절 사유, 역할명 등
│   │   │   └── validation/           # zod 스키마 (요청/응답)
│   │   └── package.json
│   │
│   └── device-adapters/              # 단말기 추상화 + 구현체
│       ├── src/
│       │   ├── interface.ts          # AccessDeviceAdapter
│       │   ├── factory.ts            # vendor → adapter 선택
│       │   ├── adapters/
│       │   │   ├── mock.ts           # MockDeviceAdapter (Phase 7)
│       │   │   ├── suprema.ts        # SupremaAdapter (Phase 8 이후)
│       │   │   ├── zkteco.ts         # FutureZktecoAdapter (스텁)
│       │   │   └── hikvision.ts      # FutureHikvisionAdapter (스텁)
│       │   └── index.ts
│       └── package.json
│
├── supabase/
│   ├── migrations/                   # SQL 마이그레이션 (YYYYMMDDhhmmss_*.sql)
│   ├── seed.sql                      # 시드 데이터 (개발용)
│   └── config.toml
│
├── docs/                             # ← 본 폴더
├── .env.example                      # 환경변수 키 목록 (값 없음)
├── .gitignore
├── CLAUDE.md
├── package.json                      # 워크스페이스 루트
└── pnpm-workspace.yaml               # 또는 bun workspaces
```

**왜 모노레포인가:**
1. CRM 과 Workers 가 **공통 타입**(회원, 이용권, 거절 사유 등)을 공유 → `packages/shared`
2. 단말기 어댑터를 **CRM 도 사용 가능** (장비 등록 화면에서 테스트 호출)
3. 한 PR 로 프론트·백엔드·DB 마이그레이션을 **원자적**으로 머지
4. 프랜차이즈 확장 시 `apps/admin-mobile` 등 추가가 자연스러움

---

## 5. 데이터 흐름 — 출입 (face) 한 사이클

```
1. 회원이 단말기에 얼굴 노출
2. 단말기: 자체 face match → vendor_user_id 식별
3. 단말기 → Workers: POST /api/access/verify
   { branch_id, device_id, credential_type: "face", credential_value: vendor_user_id }
4. Workers: device_api_key + HMAC 검증
5. Workers → Supabase: device_users 에서 member_id 조회
6. Workers → Supabase: 회원 상태 / access_grants / memberships / trial_passes 검사
7. Workers → access_logs INSERT (success or denied + 사유)
8. Workers → 단말기 응답: { door_open: true, message: "입장 승인" }
9. 단말기: 문 개방 (또는 거절 메시지 표시)
```

---

## 6. 배포 토폴로지

```
[직원 브라우저]
   └─ HTTPS → Cloudflare Pages (apps/crm)
                  └─ fetch → Cloudflare Workers (workers/api)
                                  └─ pg → Supabase Postgres (별도 프로젝트)
                                  └─ HTTPS → 단말기 vendor API (Suprema 등)

[단말기 (지점 내 LAN)]
   └─ HTTPS (mTLS or HMAC) → Cloudflare Workers (POST /api/devices/webhook)
                                  └─ pg → Supabase Postgres
```

랭킹업앱(`game-fit-quests`) 은 별개 인프라 (별도 Supabase, 별도 Cloudflare Pages 프로젝트). Phase 4 이후에 랭킹업앱 → 153 BOXING OS Workers API 호출 또는 그 반대 방향 연동을 정의한다.

---

## 7. 비기능 요구사항 (목표)

| 항목 | 목표 |
|---|---|
| 출입 판단 응답 시간 | p95 < 300ms (Workers + Supabase 한 RTT) |
| 단말기 동기화 지연 | < 30초 (이용권 변경 → 단말기 권한 반영) |
| 가용성 | 99.9% (Cloudflare + Supabase SLA 의존) |
| 감사 로그 | 삭제 불가, 7년 보존 |
| 데이터 분리 | 지점 간 RLS 격리, 본사만 전체 조회 |

---

**다음 문서:** [01-db-schema.md](./01-db-schema.md) — 14개 테이블 + ENUM + 인덱스 + RLS

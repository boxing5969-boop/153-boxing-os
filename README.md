# 153 BOXING OS

153복싱짐 프랜차이즈 CRM + 출입통제 시스템.

> 헌장: [`CLAUDE.md`](./CLAUDE.md) — 절대 규칙 + Phase 0~8 계획
> 아키텍처 문서: [`docs/`](./docs/)

## 빠른 시작

```bash
bun install                    # 의존성 설치 (모노레포 전체)
bun run dev:crm                # CRM 개발 서버 (http://localhost:5173)
bun run dev:api                # Workers API 개발 서버 (http://localhost:8787)
bun run typecheck              # 전체 타입체크
bun run test                   # vitest (workers/api + packages/device-adapters)
bun run build                  # 전체 빌드
bun run lint                   # ESLint
bun run format                 # Prettier
```

## 모노레포 구조

```
apps/crm/                  # CRM 화면 (React + Vite + Cloudflare Pages)
workers/api/               # Cloudflare Workers (출입 판단 API)
packages/shared/           # 공통 타입/유틸
packages/device-adapters/  # 단말기 추상화 (Suprema/ZKTeco/Hikvision/Mock)
supabase/                  # DB 마이그레이션 + seed
docs/                      # 아키텍처 문서
.github/workflows/         # CI
```

## Supabase 셋업 (Phase 3)

1. **Supabase 프로젝트 생성** — Dashboard 에서 Free / Seoul 리전 / 본인 계정으로 생성
2. **API 키 복사** — Settings → API
   - `Project URL` → `VITE_SUPABASE_URL` / `SUPABASE_URL`
   - `anon public` → `VITE_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (Workers 만 사용 — 절대 클라이언트 노출 금지)
3. **로컬 환경변수 작성:**
   ```bash
   cp apps/crm/.env.example apps/crm/.env       # CRM 용 VITE_ 변수 채우기
   cp .env.example .env                         # 루트 .env (Workers 용)
   ```
4. **CLI 링크 (Supabase CLI 필요):**
   ```bash
   bunx supabase login
   bunx supabase link --project-ref <your-project-ref>
   ```
   (또는 `supabase/config.toml` 의 `project_id` 를 직접 수정)
5. **마이그레이션 적용 (선택지 2개):**
   - **A.** CLI 사용: `bunx supabase db push`
   - **B.** Dashboard 사용: Supabase Studio → SQL Editor 에 `supabase/migrations/*.sql` 7개를 순서대로 붙여넣기 (Phase 4 의 `qr_used_tokens` 포함)
6. **시드 적용 (선택):** `supabase/seed.sql` 을 SQL Editor 에 붙여넣기
7. **타입 재생성 (마이그레이션 후 권장):**
   ```bash
   bunx supabase gen types typescript --project-id <ref> > packages/shared/src/types/db.ts
   ```

## Workers API 셋업 (Phase 4)

1. **로컬 시크릿 작성:**
   ```bash
   cp workers/api/.dev.vars.example workers/api/.dev.vars
   # 그 다음 5개 시크릿 채우기:
   #   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET (Dashboard → API)
   #   QR_SIGNING_SECRET (openssl rand -base64 32)
   #   DEVICE_API_KEY    (단말기 공용 HMAC, 임의 생성)
   ```
2. **개발 서버:** `bun run dev:api` → `http://localhost:8787`
3. **수동 테스트 (curl 예시):**

   ### Health
   ```bash
   curl http://localhost:8787/health
   ```

   ### QR 발급 (Supabase JWT 필요)
   ```bash
   curl -X POST http://localhost:8787/api/access/qr/generate \
     -H "Authorization: Bearer <user-jwt>" \
     -H "Content-Type: application/json" \
     -d '{"member_id":"<uuid>","branch_id":"<uuid>"}'
   ```

   ### 출입 verify (Device HMAC 필요 — 별도 서명 스크립트 권장)
   ```bash
   # signature = hex(hmac_sha256(DEVICE_API_KEY, ts + "\n" + method + "\n" + path + "\n" + sha256(body)))
   curl -X POST http://localhost:8787/api/access/verify \
     -H "X-Device-Id: <uuid>" \
     -H "X-Timestamp: $(date +%s)" \
     -H "X-Signature: <hex>" \
     -H "Content-Type: application/json" \
     -d '{"branch_id":"...","device_id":"...","credential_type":"face","credential_value":"...","occurred_at":"..."}'
   ```

4. **프로덕션 배포 (선택, Phase 8 직전 권장):**
   ```bash
   cd workers/api
   bunx wrangler login
   bunx wrangler secret put SUPABASE_URL
   bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   bunx wrangler secret put SUPABASE_JWT_SECRET
   bunx wrangler secret put QR_SIGNING_SECRET
   bunx wrangler secret put DEVICE_API_KEY
   bunx wrangler deploy
   ```

## Phase 진행 상태

- [x] Phase 0: 폴더 진단 + git init
- [x] Phase 1: 아키텍처 문서 8종
- [x] Phase 2: 모노레포 scaffold
- [x] Phase 3: DB 스키마 + 마이그레이션
- [x] Phase 4: Workers API (verify / QR / sync / webhook / admin door)
- [x] Phase 5: CRM 화면 1차
  - [x] PR 5.1: Auth + Layout + Login + Dashboard skeleton
  - [x] PR 5.2: 회원 관리 (목록 / 신규 / 상세)
  - [x] PR 5.3: 이용권 / 체험권 (등록·정지·환불·취소 + 목록 탭)
  - [x] PR 5.4: 출입로그 + 장비 + 대시보드 실데이터
  - [x] PR 5.5: 방문자 / 지점 / 레벨 / 설정 + 사이드바 권한 필터
- [x] Phase 6: 출입권한 자동화 (DB 트리거 + Workers cron + 강제 동기화)
- [x] Phase 7: Mock Device + vitest (23 tests) + 시나리오 테스트 계획
- [x] Phase 8: 단말기 키 암호화 + Suprema scaffold + 배포 가이드 (30 tests)
- [x] Phase 9: 단말기 등록 UI + 키 회전 (POST /api/devices/register · /:id/rotate-key)
- [x] Phase 10: 직원 초대 (auth.users + profiles 자동 생성, /staff)
- [x] Phase 11: 동의 철회 자동 처리 (face_recognition 철회 → 단말기 자동 삭제)
- [x] Phase 12: Sentry 통합 (Workers + apps/crm, DSN 미설정 시 자동 no-op)
- [x] Phase 13: 비상 PIN 발급 (emergency_pins + bcrypt + verify credential_type=pin)
- [x] Phase 14: 운영 대시보드 보강 (만료예정 + 거절사유 분포 + 단말기 상세)
- [x] Phase 15: 랭킹업앱 연동 API (/api/external/me/* + 회원 매핑 UI)
- [x] Phase 16: 운영 매뉴얼 + /help 페이지 (직원용 절차서 + 거절사유 액션 매트릭스)
- [x] Phase 17: 사고 알림 자동화 (alert_events + 5분 cron + Slack webhook + /admin/alerts)
- [x] Phase 18: 매출/회계 보고 (이용권 가격 + 매출 RPC + 미납 reconciliation + CSV)
- [x] Phase 19: 모바일 키오스크 (/kiosk — 휴대폰 4자리 lookup + 출입가능 표시 + 30초 자동 초기화)

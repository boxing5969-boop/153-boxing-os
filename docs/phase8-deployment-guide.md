# Phase 8 — 운영 배포 가이드

> Phase 0-7 까지 완성된 코드를 **첫 가맹점 베타** 에 올릴 때의 체크리스트.
> Suprema 또는 다른 단말기 벤더와의 계약은 별도 트랙으로 진행.

---

## 1. 인프라 셋업 (1회성)

### 1.1 Supabase
- [ ] Pro 플랜 (RLS · 백업 · 일일 활성 사용자 한도 회피)
- [ ] 프로젝트 owner 가 본인 계정 (`boxing5969@gmail.com`)
- [ ] 모든 마이그레이션 적용 — Phase 3·4·5·6·8 = **9개 SQL 파일**
- [ ] 시드 적용 (실 운영 회원/지점은 대시보드에서 직접 등록)
- [ ] Database → Backups → Daily 활성 (Pro 플랜 기본)
- [ ] Settings → API → JWT Secret / service_role 안전 저장 (Workers 시크릿으로만)

### 1.2 Cloudflare
- [ ] Cloudflare 계정 + Workers/Pages 활성
- [ ] `wrangler login` 후 워커 배포:
  ```bash
  cd workers/api
  bunx wrangler secret put SUPABASE_URL
  bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
  bunx wrangler secret put SUPABASE_JWT_SECRET
  bunx wrangler secret put QR_SIGNING_SECRET     # openssl rand -base64 32
  bunx wrangler secret put DEVICE_API_KEY        # mock 단말기용 (또는 임시)
  bunx wrangler secret put DEVICE_KMS_KEY        # 32+ bytes — 암호화 마스터
  bunx wrangler deploy
  ```
- [ ] Workers Dashboard → Triggers → 3개 cron 등록 확인
  - `* * * * *` — sync queue
  - `*/10 * * * *` — qr cleanup
  - `5 15 * * *` — daily expiry
- [ ] Pages 프로젝트 생성 → GitHub 연결 → `apps/crm` build
  - Build command: `cd ../.. && bun install && bun run --filter '@153/crm' build`
  - Output: `apps/crm/dist`
  - Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`

### 1.3 도메인 (선택)
- [ ] CRM: `crm.153boxing.com` → Cloudflare Pages
- [ ] Workers: `api.153boxing.com` → Workers route
- [ ] Workers CORS allowlist 에 CRM 도메인 추가 (`workers/api/src/middleware/cors.ts`)

---

## 2. 첫 직원 계정 발급

```sql
-- Supabase Studio → Authentication → Add user
-- 이메일: <대표 이메일>, 비밀번호: 임시값
-- 그 다음 SQL Editor:
UPDATE profiles SET auth_user_id = (
  SELECT id FROM auth.users WHERE email = '<대표 이메일>'
) WHERE name = '본사관리자';
```

각 가맹점주/코치도 같은 절차. 실 운영에선 CRM 에 "직원 초대" 화면 추가 권장 (PR 후속).

---

## 3. 단말기 벤더 연동

### 3.1 어떤 어댑터를 쓸지

| 벤더 | 상태 | 비고 |
|---|---|---|
| `mock` | ✅ 완성 (Phase 6) | 개발/QA |
| `suprema` | 🔶 scaffold (Phase 8) | BioStar 2 SDK 계약 후 endpoint·헤더 채워야 함 |
| `zkteco` | ⚪ stub | 미구현 |
| `hikvision` | ⚪ stub | 미구현 |

### 3.2 Suprema 어댑터 완성 방법

1. **계약** — Suprema 영업팀 → BioStar 2 Cloud / On-Prem API 라이선스
2. **명세 확인** — 실제 endpoint, 인증 방식 (Bearer? BS-Session-ID? mTLS?), 페이로드
3. **`packages/device-adapters/src/adapters/suprema.ts` 의 `bioStar()` 헬퍼 + 메서드 본문 수정**
   - 현재 코드는 일반적 패턴 (`/api/users`, `/api/events/search`) 으로 작성 — 실제 명세에 맞춰 조정
   - 인증: `BS-Session-ID` 헤더 → 실제는 별도 `/api/login` 호출 후 세션 발급일 수 있음
4. **단말기 화이트리스트** — Workers 의 IP/지역 제약 필요한 벤더면 wrangler.toml `[routes]` 또는 device 측 방화벽 설정
5. **테스트** — 1대 단말기에서 회원 등록 → 출입 → 거절 시나리오 (Phase 7 §10 매핑)

### 3.3 단말기 등록 (운영 시)

CRM 에 등록 화면이 아직 없으므로 (Phase 8 후속), **SQL Editor 로 직접 INSERT**:

```sql
-- 1) 임의 32-byte 키 생성 (CRM 후속 화면 추가 시 자동화)
-- openssl rand -base64 32  → 평문 키 (한 번만 노출, 단말기 측에 입력)
-- Workers 가 이 키를 AES-GCM 으로 암호화해서 저장 — 현재는 수동:
--
-- a) Workers 측에 임시 RPC 호출이 없으므로 다음 절차로 안전하게 등록:
--    1. 평문 키 생성
--    2. Workers 의 keyEncryption 함수로 암호화 (개발 머신에서 1회 실행 — Workers 환경 외부에서는 동일 코드를 Node 로 실행)
--    3. 암호문을 SQL INSERT
--
-- b) 또는 mock 벤더로 등록 후 추후 vendor 변경:
INSERT INTO access_devices (
  branch_id, device_name, device_type, vendor, device_identifier,
  api_endpoint, status
) VALUES (
  '<branch uuid>', '입구 얼굴인식기', 'face_terminal', 'mock', 'TEMP-001',
  NULL, 'active'
);
-- 추후 Suprema 계약 시 vendor='suprema', api_endpoint='https://...', api_key_encrypted=... 로 UPDATE
```

> **Phase 8 후속 작업으로 권장**: CRM `/devices/new` 페이지 + Workers `POST /api/devices/register` (랜덤키 생성 + 암호화 + 1회 평문 응답).

---

## 4. 보안 체크리스트

- [ ] `DEVICE_KMS_KEY` 시크릿 분실 시 모든 단말기 키 복구 불가 → **별도 안전 보관** (1Password / HashiCorp Vault)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` 절대 클라이언트(`apps/crm`) 노출 금지
- [ ] `apps/crm/.env` 의 `VITE_SUPABASE_ANON_KEY` 만 빌드에 포함됨 — 정상
- [ ] 단말기 측 방화벽: Workers IP 만 outbound 허용 (가능하면)
- [ ] `access_logs` UPDATE/DELETE 차단 트리거 동작 확인 (Phase 3 §3.10)
- [ ] RLS 정책 단위 검증 — 가맹점주가 다른 지점 회원 조회 시도 시 0 row (`docs/phase7-test-plan.md` 시나리오 9-10)
- [ ] 분기별 직원 권한 감사 (퇴사자 `profiles.status='inactive'` + auth.users 비활성화)
- [ ] 회원 동의 철회 처리 RPC 추가 (Phase 9 검토) — 현재는 수동
- [ ] 요금 알람 — Cloudflare/Supabase 월별 사용량 임계값 설정

---

## 5. 모니터링 (선택, 권장)

- **Cloudflare Workers Logs** — `wrangler tail` 또는 Dashboard → Logs (실시간 invocation)
- **Sentry** — Workers + apps/crm 에 `@sentry/cloudflare` / `@sentry/react` 통합 (Phase 9 후속)
- **Logtail / Better Stack** — access_logs 의 distinct denied_reason 알람
- **Slack/Discord webhook** — `device_sync_jobs.status='failed'` count 가 임계값 넘을 때 호출
  (Workers cron 의 5번째 cron 으로 추가 가능)

---

## 6. 베타 운영 시작 — Day 1 체크리스트

| 항목 | 확인 |
|---|---|
| `bun run test` 23개 통과 | □ |
| Cloudflare Pages CRM 빌드 성공 | □ |
| Workers `/health` 200 OK | □ |
| Workers 3개 cron 활성 | □ |
| Supabase 9개 마이그레이션 적용 + access_logs 트리거 동작 | □ |
| 본사관리자/가맹점주/코치 1명씩 로그인 + 메뉴 보임 (RLS 검증) | □ |
| Mock 단말기 1대로 시나리오 1·2·3 (`docs/phase7-test-plan.md`) 수동 통과 | □ |
| 일일 백업 활성 + 1주일 보존 확인 | □ |
| 운영 문서: 직원 매뉴얼 (회원 등록/이용권 등록/거절 사유 안내) 1장 작성 | □ |
| 사고 대응 매뉴얼 (DB 다운/단말기 오프라인/키 유출 시 절차) 1장 작성 | □ |

---

## 7. Phase 9 이후 검토 사항

(Phase 9 는 본 프로젝트 범위 외 — 베타 운영 후 결정)

- 회원 모바일 (랭킹업앱) 과의 양방향 API 연동 (이용권 조회 + QR 발급 위임)
- CRM 직원 초대 화면 + 단말기 등록 화면
- 비상 PIN 발급 RPC + audit
- 동의 철회 자동 처리 (`consent_records.revoked_at` → device_sync_jobs)
- 다중 지점 통합 대시보드 (지점별 비교 차트)
- 모바일 키오스크 모드 (회원이 본인 정보 확인)

---

## 8. 실 단말기 어댑터 — Contract Gap (Suprema/ZKTeco/Hikvision)

Mock adapter 는 `packages/device-adapters/test/contract.test.ts` 의 14개 불변식을
모두 통과한다. 실 벤더 어댑터로 갈아끼우기 전에 같은 contract 를 통과시켜야 한다.

현재 SupremaAdapter 의 알려진 위반 (BioStar 2 명세 확보 후 수정):

| 메서드 | 위반 | mock 동작 | suprema 현재 동작 | 영향 |
|---|---|---|---|---|
| `disableUser` | 미존재 user 호출 시 throw | no-op | 404 → Error throw | 이미 삭제된 회원 동기화 시 `device_sync_jobs.status='failed'` 누적 |
| `deleteUser` | 동일 | no-op | 404 → throw | 동일 |
| `removeAccessGroup` | 동일 | no-op | 404 → throw | 권한 회수 작업 실패 |
| `assignAccessGroup` | 같은 group 두 번 → 409 가능 | 멱등 (1개) | 409 → throw | 재시도 시 실패 |
| `createUser` | 같은 member id 충돌 가능 | 1개로 수렴 | 409 → throw | 재등록 실패 |

### 수정 가이드 (SDK 명세 확보 후)
- `bioStar()` 헬퍼에 `ignoreNotFound`, `ignoreConflict` 옵션 추가
- 멱등 메서드(`disableUser`, `deleteUser`, `removeAccessGroup`)는
  404/410 응답을 swallow → no-op 로 처리
- 충돌 가능 메서드(`createUser`, `assignAccessGroup`)는 409 응답을
  swallow → 기존 리소스 조회·반환

### 통합 테스트
- 실 BioStar 인스턴스 또는 SDK 제공 모의 서버에 대해
  `test/contract.test.ts` 패턴을 복제한 `test/suprema-contract.test.ts` 작성
- fetch mock 으로 모의 서버 흉내도 가능 (msw 또는 vi.spyOn(globalThis, "fetch"))

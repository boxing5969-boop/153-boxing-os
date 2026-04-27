# 02. API 설계

> Phase 1 산출물 #4 — Cloudflare Workers API 상세
> 작성일: 2026-04-28

---

## 1. 공통 규칙

### 1.1 응답 형식 (CLAUDE.md L339)
```typescript
type ApiResponse<T> =
  | { success: true; data: T; message?: string }
  | { success: false; error: { code: string; message: string }; data?: null };
```

### 1.2 인증 방식

| 호출자 | 인증 | 헤더 |
|---|---|---|
| CRM (직원) | Supabase JWT | `Authorization: Bearer <jwt>` |
| 단말기 | device_api_key + HMAC | `X-Device-Id`, `X-Signature`, `X-Timestamp` |
| 랭킹업앱 (회원) | Supabase JWT (랭킹업앱 측 토큰을 별도로 신뢰) | Phase 4+ 결정 |

### 1.3 HMAC 서명 (단말기)
```
signature = hex(hmac_sha256(
  key   = device_api_key,
  data  = timestamp + "\n" + method + "\n" + path + "\n" + sha256(body)
))
```
- `X-Timestamp` 와 서버 시각 차이 ±60초 이내만 허용 (replay 방지)
- `device_api_key` 는 평문 저장 금지, `access_devices.api_key_hash` 에 bcrypt 저장

### 1.4 에러 코드
```
AUTH_REQUIRED          | 401
INVALID_DEVICE_KEY     | 401
INVALID_SIGNATURE      | 401
TIMESTAMP_OUT_OF_RANGE | 401
PERMISSION_DENIED      | 403
DEVICE_NOT_FOUND       | 404
MEMBER_NOT_FOUND       | 404
DENIED_<reason>        | 200 (door_open=false)
INTERNAL_ERROR         | 500
```

---

## 2. 출입 판단

### POST /api/access/verify

**목적:** QR 리더기 / 얼굴인식기 / 카드리더기 / 관리자가 출입 요청 시 호출.

**인증:** device HMAC

**요청:**
```json
{
  "branch_id": "uuid",
  "device_id": "uuid",
  "credential_type": "face | qr | card | pin | admin | visitor",
  "credential_value": "string",
  "occurred_at": "2026-04-28T10:30:00Z"
}
```

**처리 순서:**
1. device HMAC 검증 (기각 시 `INVALID_SIGNATURE`)
2. `access_devices` 에서 `device_id` 활성 확인 + `branch_id` 일치 (`DEVICE_NOT_FOUND`)
3. credential 으로 `member_id` 식별:
   - `face`: `device_users.vendor_user_id` 매칭
   - `qr`: 토큰 검증 (3 참조)
   - `card`: `device_users` (vendor_user_id = 카드 ID)
   - `pin`: `staff_pins` 테이블 (Phase 4 추가, 본 문서엔 미정)
   - `admin`: 관리자 JWT 별도 처리 (POST /api/admin/door/open 분리)
4. 회원 식별 실패 시 → `access_logs(result='denied', denied_reason='unknown_user')` 기록 후 `door_open=false` 응답
5. 회원 상태 검사 (members.status):
   - `expired` → `expired_membership`
   - `unpaid` → `unpaid`
   - `suspended` → `suspended`
   - `withdrawn` → `unknown_user` (정보 노출 최소화)
6. `access_grants` WHERE `member_id` AND `status='active'` AND `valid_until > now()` 확인
7. 6 미존재 시 `memberships` / `trial_passes` 추가 검사 (이행 grant 자동 생성 옵션)
8. 통과 시 `result='success'` 로그 + `door_open=true`
9. trial_passes 사용 시 `used_entries++` (락 + 검사)

**성공 응답:**
```json
{
  "success": true,
  "data": {
    "door_open": true,
    "member_id": "uuid",
    "member_name": "홍길동",
    "message": "입장 승인",
    "log_id": "uuid"
  }
}
```

**거절 응답:**
```json
{
  "success": true,
  "data": {
    "door_open": false,
    "denied_reason": "expired_membership",
    "message": "이용권이 만료되었습니다.",
    "log_id": "uuid"
  }
}
```

> 거절도 `success:true` 로 응답함 — 비즈니스 로직 정상 작동. 단말기는 `door_open` 필드만 보고 동작.

---

## 3. QR 토큰 발급 / 검증

### POST /api/access/qr/generate

**목적:** 랭킹업앱이 회원 1회용 QR 토큰을 발급받음.

**인증:** Supabase JWT (랭킹업앱 측 회원)

**요청:**
```json
{
  "member_id": "uuid",
  "branch_id": "uuid"
}
```

**토큰 구조:**
```
qrToken = base64url(JSON.stringify({
  member_id, branch_id,
  nonce: random(16),
  expires_at: now() + 60s,
  signature: hmac_sha256(QR_SIGNING_SECRET, payload)
}))
```

**응답:**
```json
{
  "success": true,
  "data": {
    "qr_token": "eyJ...",
    "expires_at": "2026-04-28T10:31:00Z",
    "ttl_seconds": 60
  }
}
```

**검증 (POST /api/access/verify 내부 호출):**
1. base64url 디코드 → JSON 파싱
2. signature 재계산 → 불일치 시 `qr_invalid_signature`
3. `expires_at < now()` → `qr_expired`
4. `nonce` 가 `qr_used_tokens` (TTL 5분 KV 또는 Postgres) 에 있으면 `qr_already_used`
5. 통과 시 nonce 등록 + 출입 판단 진행

**KV vs Postgres:**
- 1차: Cloudflare Workers KV (`QR_USED` namespace, TTL 60초+여유)
- KV 가용성 이슈 시: Postgres `qr_used_tokens(nonce text PK, used_at timestamptz, expires_at timestamptz)` 백업

---

## 4. 단말기 동기화

### POST /api/devices/sync-member

**목적:** 회원권 등록·연장·만료·정지 시 CRM 이 단말기 권한을 동기화.

**인증:** Supabase JWT (CRM 직원)

**요청:**
```json
{
  "member_id": "uuid",
  "action": "create | update | disable | delete"
}
```

**처리:**
1. CRM 직원 권한 확인 (RLS — 자기 지점 회원만)
2. 해당 회원의 `device_users` 모두 조회
3. 각 device 별로 `device_sync_jobs` INSERT (status='pending')
4. 백그라운드 워커(`workers/api` 의 cron trigger 또는 `pg_cron`) 가 pending job 처리:
   - vendor 별 adapter 호출 (`AccessDeviceAdapter.createUser` 등)
   - 성공 → `device_sync_jobs.status='success'` + `device_users.last_synced_at`
   - 실패 → `status='failed'` + `error_message` + retry_count++
5. 즉시 응답 (작업은 비동기 처리):

```json
{
  "success": true,
  "data": {
    "sync_jobs_created": 3,
    "job_ids": ["uuid1","uuid2","uuid3"]
  },
  "message": "동기화 작업이 큐에 등록되었습니다."
}
```

### POST /api/devices/webhook

**목적:** 단말기 (Suprema/BioStar) 가 발생시킨 출입 이벤트를 수신.

**인증:** device HMAC

**요청:**
```json
{
  "device_id": "uuid",
  "events": [
    {
      "vendor_event_id": "string",
      "vendor_user_id": "string",
      "event_type": "face_match | card_swipe | door_open | denied",
      "occurred_at": "2026-04-28T10:30:00Z",
      "raw": { ... }
    }
  ]
}
```

**처리:**
1. HMAC 검증
2. 이벤트마다 `vendor_user_id` → `device_users` → `member_id` 매핑
3. CRM 측에서 자체 verify 한 결과인지 단말기 자체 결정인지 구분 (`event_type`)
4. `access_logs` INSERT (idempotency: `raw_event_id` UNIQUE 인덱스)
5. CRM 상태 갱신 필요시 (출입 후 회원 status 변경 등)

---

## 5. 관리자 원격 오픈

### POST /api/admin/door/open

**목적:** 관리자가 원격으로 문을 연다. 항상 access_logs 기록 (`credential_type='admin'`).

**인증:** Supabase JWT (super_admin / hq_admin / branch_owner)

**요청:**
```json
{
  "device_id": "uuid",
  "reason": "string (필수)"
}
```

**처리:**
1. 권한 확인 — branch_owner 는 자기 지점 device 만
2. `reason` 빈 문자열 거부
3. device adapter `openDoor(device)` 호출
4. `access_logs(credential_type='admin', result='success', member_id=호출자.profile_id)` 기록
   - member_id 컬럼은 호출자 profile.id (감사용)
5. 응답:

```json
{
  "success": true,
  "data": {
    "log_id": "uuid",
    "device_id": "uuid",
    "opened_at": "2026-04-28T10:30:00Z"
  },
  "message": "문이 열렸습니다."
}
```

---

## 6. 회원 조회 (CRM 내부 API)

### GET /api/members?branch_id=&status=&q=

**목적:** CRM 회원 목록 + 검색.
**인증:** Supabase JWT
**RLS:** 자기 지점만 (DB 레벨)

### GET /api/members/:id
회원 상세 + 활성 이용권 + 출입 가능 여부.

### POST /api/memberships
이용권 등록.

### PATCH /api/memberships/:id
이용권 수정 (정지·환불·연장).

### GET /api/access-logs?branch_id=&member_id=&from=&to=&result=
출입 로그 필터.

> 6장 엔드포인트는 Phase 5 (CRM 화면 1차) 에서 상세 정의.

---

## 7. 랭킹업앱 연동 API (Phase 4+ 정의 예정)

다음 API 는 **추후 정의**. 현재는 후보 목록만:

- `GET /api/external/me/membership` — 랭킹업앱 회원 ID → 현재 이용권 상태
- `POST /api/external/me/qr` — QR 발급 (위 3장 재사용)
- `GET /api/external/me/access-logs` — 본인 출입 이력
- `GET /api/external/me/level` — 본인 레벨 진행도

랭킹업앱 측 인증을 어떻게 신뢰할지(별도 partner secret + JWT 검증 등) Phase 4 에서 결정.

---

## 8. Cloudflare Workers 구조 (`workers/api/src/`)

```
src/
├── index.ts                  # Hono app entry
├── middleware/
│   ├── cors.ts
│   ├── jwt.ts                # Supabase JWT 검증
│   ├── deviceAuth.ts         # device HMAC 검증
│   └── errorHandler.ts
├── routes/
│   ├── access.ts             # /access/verify, /access/qr/*
│   ├── devices.ts            # /devices/sync-member, /devices/webhook
│   ├── admin.ts              # /admin/door/open
│   ├── members.ts            # /members/*  (Phase 5)
│   └── memberships.ts        # /memberships/*  (Phase 5)
├── services/
│   ├── accessVerifier.ts     # 출입 판단 핵심 로직
│   ├── qrToken.ts            # QR 발급/검증
│   ├── syncQueue.ts          # device_sync_jobs 처리
│   └── auditLogger.ts        # access_logs INSERT 헬퍼
└── lib/
    ├── supabase.ts           # service role 클라이언트
    ├── hmac.ts
    └── env.ts                # wrangler bindings 타입
```

---

**다음 문서:** [03-access-flow.md](./03-access-flow.md) — 출입 흐름도 (시퀀스)

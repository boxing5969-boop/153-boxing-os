# 외부 파트너 API (랭킹업앱 연동)

> 153-boxing-os ↔ 랭킹업앱(`game-fit-quests`) 양방향 연동 사양.
> 본 API 는 **랭킹업앱의 백엔드/Edge Function 에서만** 호출하세요. 브라우저 직접 호출 금지 (PARTNER_API_KEY 노출 위험).

---

## 1. 셋업

### 153 측 (Workers)
```bash
cd workers/api
# 32+ byte 임의 키 생성
openssl rand -base64 48 | bunx wrangler secret put PARTNER_API_KEY
bunx wrangler deploy
```

### 랭킹업앱 측 (예: Supabase Edge Function 또는 백엔드)
```bash
# Supabase secrets 또는 .env 에 저장
PARTNER_153_BASE=https://153-boxing-os-api.your-account.workers.dev
PARTNER_153_KEY=<위에서 생성한 동일 키>
```

### 회원 매핑
CRM `/members/:id` → 기본정보 카드 → "랭킹업 연결" → 랭킹업 user.id (uuid) 입력. 미연결 시 외부 API 가 `404 NOT_REGISTERED` 반환.

---

## 2. 인증

모든 `/api/external/*` 요청에 다음 두 헤더 필요:

| 헤더 | 값 |
|---|---|
| `X-Partner-Key` | 위 PARTNER_API_KEY 평문 (timing-safe 비교) |
| `X-Ranking-User-Id` | 랭킹업 회원의 Supabase auth `user.id` (uuid) |

응답 형식 (모든 엔드포인트 공통):
```json
{ "success": true, "data": { ... }, "message": "..." }
{ "success": false, "error": { "code": "...", "message": "..." } }
```

에러 코드:
- `AUTH_REQUIRED` (401) — 헤더 누락
- `INVALID_PARTNER_KEY` (401) — 키 불일치
- `NOT_REGISTERED` (404) — 랭킹업 user.id 가 153 회원과 미연결
- `INVALID_REQUEST` (400) — uuid 형식 오류 등

---

## 3. 엔드포인트

### GET /api/external/me/membership
회원의 활성 이용권 + 출입 가능 여부 + 최근 5건 이력.

**응답**:
```json
{
  "success": true,
  "data": {
    "member": { "id": "...", "name": "김복싱", "status": "active" },
    "branch_id": "...",
    "can_enter": true,
    "cannot_enter_reason": null,
    "active_membership": {
      "id": "...", "plan_name": "월간권 30일",
      "start_date": "2026-04-01", "end_date": "2026-05-01",
      "status": "active", "payment_status": "paid"
    },
    "active_trial": null,
    "memberships": [...],
    "trials": [...]
  }
}
```

`cannot_enter_reason` 가능 값: `expired_membership` / `unpaid` / `suspended` / `unknown_user` / `no_valid_grant`.

---

### POST /api/external/me/qr
1회용 QR 토큰 발급. 60초 TTL. 단말기 verify 후 nonce 1회 사용.

**응답**:
```json
{
  "success": true,
  "data": {
    "qr_token": "eyJ...",
    "expires_at": "2026-04-29T10:31:00Z",
    "ttl_seconds": 60
  }
}
```

랭킹업앱은 이 토큰을 사용자 화면에 QR 코드로 렌더링. 단말기 측은 `/api/access/verify` 의 `credential_type=qr` + `credential_value=qr_token` 으로 검증.

---

### GET /api/external/me/access-logs?limit=20
회원의 출입 이력 (최신순).

**Query**: `limit` (1~100, 기본 20)

**응답**:
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "...",
        "credential_type": "face",
        "result": "success",
        "denied_reason": null,
        "occurred_at": "2026-04-29T10:30:00Z",
        "branch_id": "..."
      }
    ]
  }
}
```

---

### GET /api/external/me/levels
회원의 White/Blue/Red/Black × Lv1~10 진행도.

**응답**:
```json
{
  "success": true,
  "data": {
    "levels": [
      { "tier": "white", "level": 1, "status": "passed", "tested_at": "...", "approved_by": "..." },
      ...
    ]
  }
}
```

---

### GET /api/external/me/profile
회원의 기본 프로필 (이름, 전화, 생년월일, 성별, 상태, 지점명).

**응답**:
```json
{
  "success": true,
  "data": {
    "id": "...",
    "name": "김복싱",
    "phone": "010-1234-5678",
    "birth_date": "1995-06-15",
    "gender": "male",
    "status": "active",
    "created_at": "2025-01-10T09:00:00Z",
    "branches": { "name": "강남점" }
  }
}
```

---

### GET /api/external/me/body-measurements?limit=20
체성분 기록 (최신순).

**Query**: `limit` (1~50, 기본 20)

**응답**:
```json
{
  "success": true,
  "data": {
    "measurements": [
      {
        "id": "...",
        "measured_at": "2026-05-01T10:00:00Z",
        "weight_kg": 72.5,
        "body_fat_pct": 18.3,
        "muscle_mass_kg": 55.2,
        "bmi": 23.1
      }
    ]
  }
}
```

---

### GET /api/external/me/workouts?limit=20
운동 일지 (최신순).

**Query**: `limit` (1~50, 기본 20)

**응답**:
```json
{
  "success": true,
  "data": {
    "workouts": [
      {
        "id": "...",
        "logged_date": "2026-05-15",
        "duration_min": 60,
        "intensity": "moderate",
        "note": "스파링 위주"
      }
    ]
  }
}
```

`intensity` 가능 값: `light` / `moderate` / `intense`

---

### GET /api/external/health
인증 불필요. 연결 상태 확인용.

**응답**:
```json
{
  "success": true,
  "data": {
    "ok": true,
    "version": "1.0",
    "timestamp": "2026-05-19T10:00:00Z"
  }
}
```

---

## 4. 호출 예시 (랭킹업앱 server-side)

```ts
// Supabase Edge Function 예시
const PARTNER_153_BASE = Deno.env.get("PARTNER_153_BASE")!;
const PARTNER_153_KEY = Deno.env.get("PARTNER_153_KEY")!;

async function get153Membership(rankingUserId: string) {
  const res = await fetch(`${PARTNER_153_BASE}/api/external/me/membership`, {
    headers: {
      "X-Partner-Key": PARTNER_153_KEY,
      "X-Ranking-User-Id": rankingUserId,
    },
  });
  const json = await res.json();
  if (!json.success) {
    if (json.error?.code === "NOT_REGISTERED") return null;
    throw new Error(json.error?.message ?? "153 API 호출 실패");
  }
  return json.data;
}
```

---

## 5. 보안 권장

| 항목 | 권장 |
|---|---|
| PARTNER_API_KEY 노출 | 파트너 서버/Edge Function 만 — 브라우저 절대 금지 |
| 키 회전 | 분기 1회 권장 (`wrangler secret put` 으로 재발급) |
| Rate limit | Cloudflare WAF 또는 Workers KV 로 IP/파트너 단위 제한 검토 |
| Audit | 153 측은 Sentry + access_logs 로 호출 추적 |

---

## 6. 추후 확장 (Phase 16+)

- `POST /api/external/links/initiate` — 랭킹업앱이 회원 매핑을 자체 인증으로 신청 (이메일/전화 매칭)
- 양방향: 153 → 랭킹업앱 (출입 후 알림 전송)
- Webhook 시 partner-side HMAC signing 도입

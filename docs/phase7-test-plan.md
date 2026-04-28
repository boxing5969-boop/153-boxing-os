# Phase 7 — 통합 테스트 계획 (10 시나리오)

> CLAUDE.md L302-313 의 10가지 테스트 시나리오를 자동화·수동 테스트로 매핑.
> 자동화: vitest 단위 테스트 (hmac / qrToken / MockDeviceAdapter).
> 수동: Supabase SQL Editor + curl 스크립트.

---

## 자동화 테스트 (CI 에서 매번 실행)

```bash
bun run test       # workers/api + packages/device-adapters
```

| 파일 | 케이스 |
|---|---|
| `workers/api/test/hmac.test.ts` | sign+verify roundtrip, 변조/오시크릿/형식 거부, sha256 알려진 값 |
| `workers/api/test/qrToken.test.ts` | 생성+검증, 60초 만료, 변조 페이로드 거부, nonce 유일성 |
| `packages/device-adapters/test/mock.test.ts` | createUser/disable/delete, assignGroup, pullAccessLogs since 필터, openDoor, ping, __mockReset |

---

## 수동 시나리오 (실 환경 검증)

준비: Phase 3 시드 + Phase 4 dev API + 본사관리자 로그인.

### 시나리오 1 — 정상 회원 face → 입장 성공

**Setup**: 김복싱 (active, 30일 이용권 paid) + 강남점 mock 단말기.

**Action (SQL Editor)**:
```sql
-- 1) 단말기-회원 매핑 (PR 6 trigger 가 자동으로 만들 수도 있음. 없으면 수동:)
INSERT INTO device_users (member_id, device_id, vendor_user_id, face_registered)
VALUES (
  '00000000-0000-0000-0000-000000001001',
  '00000000-0000-0000-0000-000000002001',
  'mock_00000000-0000-0000-0000-000000001001',
  true
) ON CONFLICT DO NOTHING;
```

curl `/api/access/verify` (HMAC 서명 별도 스크립트 필요):
```json
{
  "branch_id": "00000000-0000-0000-0000-000000000010",
  "device_id": "00000000-0000-0000-0000-000000002001",
  "credential_type": "face",
  "credential_value": "mock_00000000-0000-0000-0000-000000001001",
  "occurred_at": "2026-04-29T10:00:00Z"
}
```

**Expected**: `door_open: true`, `member_name: "김복싱"`, access_logs 에 success row.

---

### 시나리오 2 — 만료 회원 face → 거절 (expired_membership)

**Setup**: 박만료 (status='expired').

**Action**: 시나리오 1 과 동일하되 credential_value = `mock_00000000-0000-0000-0000-000000001003`.

**Expected**: `door_open: false`, `denied_reason: "expired_membership"`.

---

### 시나리오 3 — 미납 회원 face → 거절 (unpaid)

**Setup**: 최미납 (status='unpaid').

**Expected**: `denied_reason: "unpaid"`.

---

### 시나리오 4 — 체험권 1회 사용 후 재입장 → 거절 (trial_max_used)

**Setup**: 이체험 (trial, 7일 1회권).

**Action**: 첫 verify → success + used_entries 1 증가. 즉시 재호출 → trial_max_used 또는 active 이용권/권한 검사로 거절.

**Expected**:
- 1차: `door_open: true` (trial 사용 +1)
- 2차: `denied_reason: "trial_max_used"` (used >= max)

---

### 시나리오 5 — QR 토큰 만료 후 → 거절 (qr_expired)

**Action**:
```bash
# 1) QR 발급
curl -X POST http://localhost:8787/api/access/qr/generate \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"member_id":"...","branch_id":"..."}'

# 2) 60초 이상 대기 후 verify
sleep 65
curl -X POST http://localhost:8787/api/access/verify \
  -H "X-Device-Id: ..." -H "X-Timestamp: ..." -H "X-Signature: ..." \
  -d '{"credential_type":"qr","credential_value":"<token>",...}'
```

**Expected**: `denied_reason: "qr_expired"`. (자동화: `qrToken.test.ts → rejects expired token`)

---

### 시나리오 6 — QR 캡처 재사용 → 거절 (qr_already_used)

**Action**: 시나리오 5 의 QR 을 60초 안에 두 번 호출.

**Expected**: 1차 success, 2차 `denied_reason: "qr_already_used"` (qr_used_tokens 에 nonce 기록됨).

---

### 시나리오 7 — 관리자 원격 오픈

**Action**:
```bash
curl -X POST http://localhost:8787/api/admin/door/open \
  -H "Authorization: Bearer <super_admin-jwt>" \
  -d '{"device_id":"...","reason":"VIP 방문"}'
```

**Expected**:
- 응답: `{ log_id, device_id, opened_at, reason }`
- access_logs INSERT (`credential_type='admin'`, `result='success'`, `raw_event_id` 에 admin profile id + reason)

---

### 시나리오 8 — 단말기 동기화 실패 → 대시보드 표시

**Setup**: device.vendor 를 'suprema' 로 변경 (어댑터가 throw).
```sql
UPDATE access_devices SET vendor='suprema'
 WHERE id='00000000-0000-0000-0000-000000002001';
```

**Action**: 회원 이용권 등록 (PR 5.3 UI) → 트리거가 sync_job INSERT.

**Expected**: 1분 cron 5회 동안 retry → retry_count=5 도달 → `device_sync_jobs.status='failed'` + `access_devices.status='error'`. 대시보드 "단말기 동기화 실패" 위젯이 카운트 표시.

복구:
```sql
UPDATE access_devices SET vendor='mock', status='active'
 WHERE id='00000000-0000-0000-0000-000000002001';
```
또는 `/devices` 페이지 "강제 동기화" 버튼.

---

### 시나리오 9 — 코치 RLS (담당 회원만 조회)

**Setup**: 강남점코치 auth_user_id 연결 (Phase 5.1 동일 절차).

**SQL Editor (코치 JWT 로 로그인 필요 — Studio 의 SQL editor 는 anon, 다음은 client-side 검증)**:

apps/crm 에서 코치 계정으로 로그인:
- `/members` → 김복싱(담당), 이체험(담당), 최미납(담당) 만 보임
- 박만료, 정정지 (담당 아님) 보이지 않음

또는 SQL 검증 (service_role 우회):
```sql
-- impersonate coach via JWT 는 불가, 대신 정책 함수 직접 호출
SELECT is_coach_of('00000000-0000-0000-0000-000000001001'); -- TRUE 기대
SELECT is_coach_of('00000000-0000-0000-0000-000000001003'); -- FALSE 기대 (담당 아님)
```

---

### 시나리오 10 — 가맹점주 RLS (자기 지점만)

**Setup**: 강남점장 auth_user_id 연결.

**Verify**:
- /members 에서 강남점 회원만 (5명)
- 종로점에 회원 추가했다면 보이지 않음

SQL 검증:
```sql
INSERT INTO members (company_id, branch_id, name, status)
 VALUES (
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000011', -- 종로점
   '종로테스트', 'trial'
 );

-- 강남점장 JWT 컨텍스트에서:
SELECT count(*) FROM members WHERE branch_id='00000000-0000-0000-0000-000000000011';
-- → 0 기대 (RLS 차단)
```

---

## 시나리오 → 자동화/수동 매핑 요약

| # | 시나리오 | 자동화 (vitest) | 수동 (실환경) |
|---|---|---|---|
| 1 | 정상 face | ⚙ MockDeviceAdapter store | ✅ curl |
| 2 | 만료 face | — | ✅ curl |
| 3 | 미납 face | — | ✅ curl |
| 4 | 체험권 소진 | — | ✅ curl ×2 |
| 5 | QR 만료 | ✅ qrToken.test.ts | (자동화 충분) |
| 6 | QR 재사용 | — | ✅ curl ×2 |
| 7 | 관리자 오픈 | — | ✅ curl |
| 8 | 동기화 실패 | — | ✅ DB + 1분 대기 ×5 |
| 9 | 코치 RLS | — | ✅ UI/SQL |
| 10 | 가맹점주 RLS | — | ✅ UI/SQL |

자동화 비중: hmac/qrToken/MockDeviceAdapter 단위 테스트만. 통합 e2e (Supabase 실연결) 는 Phase 8 의 실 단말 테스트와 함께 보강 예정.

---

## CI 통합

`.github/workflows/ci.yml` 에 다음 단계 포함:

```yaml
- run: bun run test
```

PR/push 마다:
1. typecheck
2. lint
3. test (vitest)
4. build

위 4단계 모두 통과해야 머지 가능.

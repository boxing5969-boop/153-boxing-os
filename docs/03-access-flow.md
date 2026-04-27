# 03. 출입 흐름도

> Phase 1 산출물 #5 — 시퀀스 다이어그램 (mermaid)
> 작성일: 2026-04-28

---

## 1. 시나리오 요약

| # | 시나리오 | credential | 결과 |
|---|---|---|---|
| A | 정상 회원 얼굴인식 입장 | face | success |
| B | 만료 회원 얼굴인식 시도 | face | denied (expired_membership) |
| C | 랭킹업앱 QR 입장 | qr | success |
| D | QR 캡처 재사용 시도 | qr | denied (qr_already_used) |
| E | 관리자 원격 오픈 | admin | success |
| F | 단말기가 자체 거절 후 webhook | webhook | denied (단말기 측 결정) |
| G | 이용권 등록 → 단말기 동기화 | sync | async |

---

## 2. 시나리오 A — 정상 회원 얼굴인식 입장

```mermaid
sequenceDiagram
    participant M as 회원
    participant D as 얼굴인식 단말기
    participant W as Workers API
    participant DB as Supabase DB

    M->>D: 얼굴 노출
    D->>D: 자체 face match → vendor_user_id
    D->>W: POST /api/access/verify<br/>(HMAC, branch_id, device_id, face, vendor_user_id)
    W->>W: HMAC 검증
    W->>DB: access_devices 활성 확인
    W->>DB: device_users WHERE device_id+vendor_user_id<br/>→ member_id
    W->>DB: members.status = 'active'?
    W->>DB: access_grants 활성 + memberships 유효?
    DB-->>W: OK
    W->>DB: INSERT access_logs (success)
    W-->>D: { door_open: true, message: "입장 승인" }
    D->>D: 릴레이 ON → 문 개방
    D-->>M: 입장 안내 (LED + 음성)
```

응답 시간 목표: p95 < 300ms (단말기→Workers→DB→응답).

---

## 3. 시나리오 B — 만료 회원 얼굴인식 거절

```mermaid
sequenceDiagram
    participant M as 회원
    participant D as 얼굴인식 단말기
    participant W as Workers API
    participant DB as Supabase DB

    M->>D: 얼굴 노출
    D->>W: POST /api/access/verify (face)
    W->>DB: device_users → member_id
    W->>DB: members.status
    DB-->>W: status = 'expired'
    W->>DB: INSERT access_logs (denied, expired_membership)
    W-->>D: { door_open: false, denied_reason: "expired_membership",<br/>message: "이용권이 만료되었습니다." }
    D-->>M: 거절 안내 (빨간 LED + "이용권 갱신 후 입장 가능")
```

`unpaid`, `suspended`, `trial_max_used` 도 동일 패턴, denied_reason 만 다름.

---

## 4. 시나리오 C — 랭킹업앱 QR 입장

```mermaid
sequenceDiagram
    participant M as 회원 (앱)
    participant App as 랭킹업앱
    participant W as Workers API
    participant KV as Workers KV
    participant D as QR 리더기
    participant DB as Supabase DB

    M->>App: QR 발급 버튼
    App->>W: POST /api/access/qr/generate<br/>(JWT, member_id, branch_id)
    W->>W: JWT 검증
    W->>W: nonce + expires_at(60s) + HMAC sign
    W-->>App: { qr_token, expires_at, ttl: 60 }
    App-->>M: QR 표시
    M->>D: QR 스캔
    D->>W: POST /api/access/verify (qr, qr_token)
    W->>W: 토큰 디코드 + 서명 검증
    W->>KV: QR_USED.get(nonce)?
    KV-->>W: not found
    W->>KV: QR_USED.put(nonce, ttl=120)
    W->>DB: members + grants 검사
    W->>DB: INSERT access_logs (success)
    W-->>D: { door_open: true }
    D->>D: 문 개방
```

---

## 5. 시나리오 D — QR 캡처 재사용 거절

```mermaid
sequenceDiagram
    participant Att as 캡처한 사람
    participant D as QR 리더기
    participant W as Workers API
    participant KV as Workers KV
    participant DB as Supabase DB

    Att->>D: 같은 QR 다시 스캔
    D->>W: POST /api/access/verify (qr, qr_token)
    W->>W: 서명 OK, 만료 OK
    W->>KV: QR_USED.get(nonce)
    KV-->>W: 이미 사용됨
    W->>DB: INSERT access_logs (denied, qr_already_used)
    W-->>D: { door_open: false, denied_reason: "qr_already_used" }
    D-->>Att: 거절 안내
```

토큰 만료(60초) 후라면 같은 흐름에서 `qr_expired` 로 거절. 두 검사 모두 통과해야 입장 가능.

---

## 6. 시나리오 E — 관리자 원격 오픈

```mermaid
sequenceDiagram
    participant Adm as 본사 관리자
    participant CRM as CRM 화면
    participant W as Workers API
    participant DA as Device Adapter
    participant Term as 단말기
    participant DB as Supabase DB

    Adm->>CRM: 지점 X 의 device Y "원격 오픈" 클릭
    CRM->>Adm: 사유 입력 모달
    Adm->>CRM: "VIP 방문" 입력
    CRM->>W: POST /api/admin/door/open<br/>(JWT, device_id, reason)
    W->>W: JWT 권한 확인 (super_admin/hq_admin/branch_owner)
    W->>DA: openDoor(device)
    DA->>Term: vendor API: door_open
    Term-->>DA: OK
    DA-->>W: success
    W->>DB: INSERT access_logs<br/>(credential_type='admin', result='success',<br/>member_id=관리자 profile.id)
    W-->>CRM: { log_id, opened_at, message: "문이 열렸습니다." }
    CRM-->>Adm: 토스트 알림
```

---

## 7. 시나리오 F — 단말기 자체 거절 → webhook

```mermaid
sequenceDiagram
    participant M as 회원
    participant Term as 단말기
    participant W as Workers API
    participant DB as Supabase DB

    M->>Term: 얼굴 노출
    Term->>Term: face match 실패<br/>(낯선 얼굴)
    Term->>Term: 단말기 자체 로그 + 거절
    Note over Term: 5초 또는 N건 누적 시
    Term->>W: POST /api/devices/webhook<br/>(HMAC, events: [denied face match])
    W->>W: HMAC 검증
    W->>DB: 각 event 마다 INSERT access_logs<br/>(idempotency: raw_event_id UNIQUE)
    W-->>Term: { success: true, accepted: N }
```

**중요:** webhook 은 단말기 자체 결정의 **사후 보고**. CRM 측 verify 거절은 시나리오 B 와 같이 실시간 응답 안에서 로깅됨.

---

## 8. 시나리오 G — 이용권 등록 → 단말기 동기화 (비동기)

```mermaid
sequenceDiagram
    participant Mgr as 지점 관리자
    participant CRM as CRM 화면
    participant W as Workers API
    participant DB as Supabase DB
    participant Q as device_sync_jobs (DB 큐)
    participant Cron as Workers Cron
    participant DA as Device Adapter
    participant Term as 단말기

    Mgr->>CRM: 회원 김XX 이용권 30일 등록
    CRM->>W: POST /api/memberships
    W->>DB: INSERT memberships
    W->>DB: UPSERT access_grants (membership type)
    W->>W: members.status='active' 보장
    W->>W: action='create' 로 sync 호출
    W->>Q: INSERT device_sync_jobs<br/>(pending, target=member, type=create_user)
    W-->>CRM: 등록 성공

    Note over Cron: 30초마다
    Cron->>Q: SELECT pending jobs LIMIT 100
    Q-->>Cron: jobs[]
    loop each job
        Cron->>DA: createUser/updateUser/...
        DA->>Term: vendor API
        alt 성공
            Term-->>DA: OK
            DA-->>Cron: success
            Cron->>Q: UPDATE status='success', processed_at=now
            Cron->>DB: UPDATE device_users.last_synced_at
        else 실패
            Term-->>DA: error
            DA-->>Cron: failed
            Cron->>Q: UPDATE status='failed', retry_count++,<br/>error_message
        end
    end
```

**재시도 정책:**
- `retry_count < 5` 면 다음 cron 에서 자동 재시도
- 5 도달 시 `status='failed'` 고정 + 관리자 대시보드에 표시
- 관리자가 수동 "강제 동기화" 시 retry_count 0 으로 리셋 후 재실행

---

## 9. 데이터 정합성 보증

| 위험 | 대응 |
|---|---|
| 동일 QR 토큰이 두 단말기에서 거의 동시에 스캔 | KV `put-if-not-exists` 또는 Postgres UNIQUE INSERT 로 race 방지 |
| 출입 후 단말기 응답 유실 → 다시 스캔 | webhook idempotency (raw_event_id UNIQUE) |
| 단말기 sync 실패가 누적 | device_sync_jobs.failed 카운트가 임계값 넘으면 device.status='error' 로 자동 전환 |
| 이용권 만료 시점 = 정확히 자정 | 매일 00:00 cron 으로 `memberships WHERE end_date < today` → status='expired' + sync_job INSERT |

---

**다음 문서:** [04-device-adapter.md](./04-device-adapter.md) — 하드웨어 추상화 인터페이스

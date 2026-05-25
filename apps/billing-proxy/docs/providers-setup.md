# Provider 설정 가이드 — Aligo · Payssam · 모드 전환 · 배포

이 문서는 billing-proxy 의 외부 연동을 실제 운영에 연결하기 위한 단계별 가이드다.
**시크릿은 절대 코드에 하드코딩 금지. Secret Manager 또는 환경변수만 사용.**

---

## 1. 동작 모드 — `PROVIDER_MODE=mock|live`

| `PROVIDER_MODE` | 동작 |
|---|---|
| `mock` (기본) | 외부 API 호출 없음. 예측 가능한 fake ID 반환 (`mock-sms-1`, `mock-inv-1` 등). 로컬·CI·통합 테스트용. |
| `live` | 실제 Aligo / Payssam 호출. API key 미설정 시 부팅 거부 (silent failure 방지). |

스위칭 방법:
```bash
# 로컬 dev (mock)
PROVIDER_MODE=mock bun run dev

# 로컬에서 live 흉내 (실 API 호출됨 — 주의)
PROVIDER_MODE=live ALIGO_API_KEY=xxx ALIGO_USER_ID=yyy PAYSSAM_API_KEY=zzz bun run dev

# Cloud Run 운영 (Secret Manager mount)
gcloud run services update billing-proxy --set-env-vars PROVIDER_MODE=live ...
```

호환성: 기존 `MOCK_PROVIDERS=true|false` 도 동작 (deprecated). `PROVIDER_MODE` 가 명시되면 그쪽이 우선.

---

## 2. Aligo 설정 (SMS / LMS / MMS)

### 2.1 계정 준비
1. https://smartsms.aligo.in 에 사업자 가입
2. 좌측 메뉴 **API 인증** → API Key 발급
3. `ALIGO_USER_ID` = 가입 ID, `ALIGO_API_KEY` = 발급 키
4. 발신번호 등록 (좌측 **발신번호 관리**) — Aligo 정책상 사전등록·승인 필요
5. 승인된 번호를 `message_senders` 테이블에 INSERT (또는 통합 설정 UI에서)

### 2.2 정적 outbound IP 화이트리스트
Aligo 콘솔 **API 인증 → 허용 IP 등록** 에 Cloud Run 의 NAT IP 등록.

Cloud NAT 고정 IP 발급:
```bash
# 1) 고정 IP 주소 예약 (리전 단위)
gcloud compute addresses create billing-proxy-nat-ip \
  --region=asia-northeast3

NAT_IP=$(gcloud compute addresses describe billing-proxy-nat-ip \
  --region=asia-northeast3 --format='value(address)')
echo "Aligo 콘솔에 등록할 IP: $NAT_IP"

# 2) VPC 라우터 (이미 있으면 skip)
gcloud compute routers create billing-router \
  --network=default --region=asia-northeast3

# 3) Cloud NAT 매핑
gcloud compute routers nats create billing-nat \
  --router=billing-router --region=asia-northeast3 \
  --nat-custom-subnet-ip-ranges=default \
  --nat-external-ip-pool=billing-proxy-nat-ip

# 4) Cloud Run 에 VPC 커넥터 연결
gcloud compute networks vpc-access connectors create billing-connector \
  --region=asia-northeast3 --network=default \
  --range=10.8.0.0/28

gcloud run services update billing-proxy --region=asia-northeast3 \
  --vpc-connector=billing-connector \
  --vpc-egress=all-traffic
```

Aligo 콘솔에 `$NAT_IP` 등록 후 트래픽이 화이트리스트 통과하는지 mock→live 전환 직후 검증.

### 2.3 응답 정규화 (`AligoSendResult`)

| 필드 | 의미 |
|---|---|
| `success` | 외부 호출 성공 여부 (`result_code === "1"`) |
| `status` | `"sent"` \| `"failed"` |
| `providerMessageId` | Aligo `msg_id` |
| `resultCode` | 원본 `result_code` ("1", "-99", "-101" …) |
| `errorMessage` | 사용자 친화 실패 사유 (`result_code !== "1"` 일 때만) |
| `raw` | 원본 JSON (디버깅 용) — API key 없음 |

### 2.4 메시지 타입별 분기

- `sendSms({sender, receiver, msg})` — 90 byte (EUC-KR) 이하
- `sendLms({sender, receiver, msg, title?})` — 90 byte 초과 자동 분기
- `sendMms({sender, receiver, msg, title?, imageUrl?})` — **현재 RealAligoProvider 는 NOT_IMPLEMENTED.** Mock 은 동작. 파일/이미지 핸들링 인프라 준비 후 multipart 업로드 구현.

### 2.5 보안
- API key 는 절대 로그·external_api_logs 에 포함하지 않음 (`redactAligoRequest` 사용)
- 수신번호는 마스킹 (`010****5678`) 후 로그 적재
- 프런트엔드에서 Aligo 직접 호출 금지 — billing-proxy 경유만

---

## 3. Payssam (결제선생) 설정

### 3.1 계정 준비
1. 결제선생 가맹점 가입 (https://payssam.com)
2. API Key 발급 → `PAYSSAM_API_KEY`
3. 베이스 URL 확인 → `PAYSSAM_API_BASE_URL`
4. Webhook secret 발급 → `PAYSSAM_WEBHOOK_SECRET` (없으면 서명 검증 skip — production 진입 전 필수)

### 3.2 콜백 URL 등록
결제선생 콘솔의 webhook URL 에 등록:
```
https://billing-proxy-<hash>.run.app/webhooks/payssam/payment-result
```

### 3.3 응답 정규화 (`PayssamCreateInvoiceResult`)

| 필드 | 의미 |
|---|---|
| `success` | 청구서 발행 성공 여부 |
| `status` | `"created"` \| `"failed"` |
| `providerInvoiceId` | Payssam 측 invoice ID |
| `paymentUrl` | 고객에게 보낼 결제 페이지 URL |
| `resultCode` | 원본 코드 또는 HTTP status |
| `errorMessage` | 사용자 친화 실패 사유 |
| `raw` | 원본 JSON |

### 3.4 Webhook 정규화 (`parsePaymentWebhook`)

`PayssamWebhookParseResult`:

| 필드 | 의미 |
|---|---|
| `valid` | 서명 검증 + schema 정합성 통과 여부 |
| `status` | `"paid"` \| `"cancelled"` \| `"failed"` \| `"refunded"` \| `"unknown"` |
| `providerEventId` | 외부 이벤트 ID (멱등키) |
| `providerInvoiceId` | 어떤 청구서를 갱신할지 |
| `providerPaymentId` | payments 테이블 멱등키 |
| `amountKrw` | 결제 금액 |
| `paidAt` | 결제 완료 시각 |

라우터(`webhooksPayssam.ts`)는:
1. `parsePaymentWebhook` 호출 → 정규화 결과
2. `webhook_events` 에 raw payload 멱등 저장 (`external_event_id` UNIQUE)
3. 같은 event 중복 수신 시 즉시 200 (no double process)
4. `valid=false` → 401
5. `status='unknown'` → 200 + ignored
6. matching invoice 찾으면 `payments` upsert + `service_invoices.status` 갱신

### 3.5 ⚠️ Production 진입 전 필수 작업 (RealPayssamProvider TODO)

```ts
// providers/payssam.ts — RealPayssamProvider 안의 TODO
```

1. **실 endpoint/path 확인** — 현재 `/api/v1/invoices` 는 placeholder. docs 받은 후 교체.
2. **인증 헤더 형식 확인** — Bearer vs 서명 vs 사업자번호+key 등.
3. **요청 body 필드명** — 현재 `amount/customer_*` 는 추측. 실 API 의 snake_case/camelCase 확인.
4. **응답 필드명** — `id` / `invoice_id` / `uid` 중 어느 것이 맞는지.
5. **Webhook 서명 알고리즘** — 현재 HMAC-SHA256 가정. 실 algorithm 검증 (RSA? 별도 헤더?).
6. **결제 완료 후 멤버십·access_grants 자동 연결** — service_invoices.member_id 가 있으면 후속 처리.

비즈니스 로직 (debit→call→refund + 멱등) 은 완성. **외부 API 매핑만 교체하면 됨.**

---

## 4. 로컬 테스트

```bash
cd apps/billing-proxy
cp .env.example .env
# .env 편집 — 최소 SUPABASE_URL/KEY/JWT_SECRET 만 채우면 mock 모드 동작
bun install
bun run dev

# 다른 터미널에서
curl http://localhost:8080/health

# 메시지 발송 (Supabase JWT 필요)
TOKEN="<your-supabase-user-jwt>"
curl -X POST http://localhost:8080/api/messages/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "00000000-0000-0000-0000-000000000001",
    "recipient_phone": "010-1234-5678",
    "message_type": "sms",
    "category": "informational",
    "content": "테스트 메시지",
    "idempotency_key": "local-test-1"
  }'

# Mock 모드라면 즉시 success + mock provider_message_id 반환
```

### 4.1 자동 테스트
```bash
bun run test           # vitest 44 케이스
bun run typecheck      # tsc --noEmit
bun run build          # tsc → dist/
bun run lint           # (root) bunx eslint apps/billing-proxy/src/
```

### 4.2 mock webhook 시뮬레이션
```bash
curl -X POST http://localhost:8080/webhooks/payssam/payment-result \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "evt-local-1",
    "invoice_id": "<provider_invoice_id from earlier createInvoice>",
    "payment_id": "pay-1",
    "status": "paid",
    "amount": 50000,
    "paid_at": "2026-01-01T00:00:00Z"
  }'
```

---

## 5. Cloud Run 배포

```bash
# 1) 이미지 빌드 + push (Artifact Registry)
gcloud artifacts repositories create billing-proxy \
  --repository-format=docker --location=asia-northeast3

gcloud builds submit \
  --tag asia-northeast3-docker.pkg.dev/<PROJECT>/billing-proxy/app

# 2) 시크릿 등록 (Secret Manager) — 절대 env 직접 금지
echo -n "eyJ..."     | gcloud secrets create supabase-service-role-key --data-file=-
echo -n "aligo-key"  | gcloud secrets create aligo-api-key            --data-file=-
echo -n "aligo-uid"  | gcloud secrets create aligo-user-id            --data-file=-
echo -n "payssam-k"  | gcloud secrets create payssam-api-key          --data-file=-
echo -n "wh-secret"  | gcloud secrets create payssam-webhook-secret   --data-file=-
echo -n "int-secret" | gcloud secrets create internal-task-secret     --data-file=-

# 3) Cloud Run 배포 — 시크릿은 --set-secrets 로 mount
gcloud run deploy billing-proxy \
  --image=asia-northeast3-docker.pkg.dev/<PROJECT>/billing-proxy/app \
  --region=asia-northeast3 \
  --vpc-connector=billing-connector \
  --vpc-egress=all-traffic \
  --no-allow-unauthenticated \
  --min-instances=0 --max-instances=10 --concurrency=80 \
  --set-env-vars=NODE_ENV=production,PROVIDER_MODE=live,\
SUPABASE_URL=https://<ref>.supabase.co,\
ALIGO_SENDER_DEFAULT=0212345678,\
PAYSSAM_API_BASE_URL=https://api.payssam.example.com,\
CLOUD_TASKS_PROJECT_ID=<PROJECT>,CLOUD_TASKS_LOCATION=asia-northeast3,\
CLOUD_TASKS_QUEUE_MESSAGES=billing-msg,CLOUD_TASKS_QUEUE_INVOICES=billing-inv,\
CLOUD_RUN_BASE_URL=https://billing-proxy-<hash>.run.app,\
OIDC_INVOKER_SERVICE_ACCOUNT=billing-tasks@<PROJECT>.iam.gserviceaccount.com \
  --set-secrets=SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest,\
SUPABASE_JWT_SECRET=supabase-jwt-secret:latest,\
ALIGO_API_KEY=aligo-api-key:latest,\
ALIGO_USER_ID=aligo-user-id:latest,\
PAYSSAM_API_KEY=payssam-api-key:latest,\
PAYSSAM_WEBHOOK_SECRET=payssam-webhook-secret:latest,\
INTERNAL_TASK_SECRET=internal-task-secret:latest
```

### 5.1 첫 배포 후 확인 체크리스트

- [ ] `curl https://billing-proxy-<hash>.run.app/health` 200 OK + `service: billing-proxy`
- [ ] outbound IP 확인 — Cloud Run 에서 `https://ifconfig.me` 호출해 Aligo 콘솔에 등록한 IP 와 일치
- [ ] Aligo 콘솔 → 발신번호 1개 mock send → mock 모드 응답
- [ ] PROVIDER_MODE=live 로 전환 → 실제 SMS 1건 수동 발송 검증
- [ ] 결제선생 콘솔 → webhook URL 등록 + 테스트 결제 1건
- [ ] webhook 도착 후 `webhook_events.processed=true` 확인, `payments` 1건 생성, `service_invoices.status='paid'` 확인
- [ ] 같은 결제 webhook 2회 발사 → 두 번째는 `deduplicated:true` 응답, payments 중복 없음

---

## 6. Production 진입 전 남은 일

| 항목 | 상태 |
|---|---|
| Aligo MMS multipart 구현 | ❌ placeholder (NOT_IMPLEMENTED) |
| Payssam 실 endpoint/필드/auth | ❌ placeholder — docs 받은 후 채울 것 |
| Payssam webhook 서명 알고리즘 | ⚠️ HMAC-SHA256 가정. 실 algo 확인 필요 |
| Cloud Tasks OIDC 검증 | ⚠️ `auth/verifyInternalTask.ts` TODO. 현재는 X-Internal-Secret fallback |
| Sentry 통합 | ❌ workers/api 패턴 참고해 추가 |
| Rate-limit 미들웨어 | ❌ per tenant, per IP |
| Aligo DR (전송결과) webhook 수신 | ❌ `/webhooks/aligo/dr` 추가 시 sent→delivered 추적 가능 |
| Audit Sentry/Datadog 알림 | ❌ wallet 임계치/실패율 임계치 알림 |

# @153/billing-proxy

Google Cloud Run 전용 빌링/외부연동 프록시. **이 서비스만이 Aligo·Payssam·(미래) KT API 를 호출할 수 있다.**

## 아키텍처 위치

```
[apps/crm React] ──→ [Supabase]            (auth, DB 직접 RLS)
       │
       └─→ [workers/api Cloudflare Workers] ──┐
                                               │
                          [Cloud Run: billing-proxy]   ← 이 패키지
                          - 고정 outbound IP (Cloud NAT)
                          - debit_service_wallet → call → refund-on-fail
                          - external_api_logs / webhook_events 적재
                                               │
                                               ↓
                                  [Aligo] [Payssam] [(미래) KT]
```

## 빠른 시작

```bash
cd apps/billing-proxy
cp .env.example .env       # 값 채우기 (실제 시크릿)
npm install
npm run dev                # http://localhost:8080
```

## 엔드포인트

| Method | Path | 용도 |
|---|---|---|
| GET  | `/health` | liveness + version |
| POST | `/api/messages/send` | Aligo SMS/LMS/MMS — wallet 차감 → 발송 → 실패 시 환불 |
| POST | `/api/invoices/create` | Payssam 결제 청구 — wallet 차감 → 발행 → 실패 시 환불 |
| POST | `/webhooks/payssam/payment-result` | Payssam 결제 결과 webhook (멱등) |
| POST | `/tasks/messages/process` | Cloud Tasks 큐 컨슈머 (큐된 job 처리) |

## 보안

- `SUPABASE_SERVICE_ROLE_KEY` — DB 전권. **프런트엔드에 절대 노출 금지**.
- 모든 사용자 요청은 Supabase JWT 검증 + `has_tenant_role` RPC 로 tenant 권한 강제.
- `/tasks/*` 는 `X-Internal-Secret` 또는 (운영) Cloud Tasks OIDC 검증.
- Webhook 은 raw payload 를 `webhook_events` 에 먼저 저장 → 서명 검증 → 멱등 처리.
- API 키는 `MOCK_PROVIDERS=true` 모드에서 미사용 (개발/테스트).

## 테스트

```bash
npm test
```

## 배포 (Cloud Run)

```bash
# 1) 이미지 빌드 + push (Artifact Registry)
gcloud builds submit --tag asia-northeast3-docker.pkg.dev/<PROJECT>/billing-proxy/app

# 2) 시크릿 등록 (Secret Manager)
gcloud secrets create supabase-service-role-key --replication-policy=automatic
echo -n "eyJ..." | gcloud secrets versions add supabase-service-role-key --data-file=-

# 3) Cloud Run 배포
gcloud run deploy billing-proxy \
  --image asia-northeast3-docker.pkg.dev/<PROJECT>/billing-proxy/app \
  --region asia-northeast3 \
  --vpc-connector <connector> \
  --vpc-egress all-traffic \
  --set-env-vars NODE_ENV=production,SUPABASE_URL=https://...,PAYSSAM_API_BASE_URL=... \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest,ALIGO_API_KEY=aligo-api-key:latest \
  --min-instances=0 --max-instances=10 --concurrency=80
```

## 디렉터리

```
src/
  index.ts                  Express 부트스트랩 + 라우터 등록
  config.ts                 환경변수 로드 + zod 검증
  lib/
    supabase.ts             service_role 클라이언트 싱글톤
    logger.ts               pino 구조화 로거
    errors.ts               에러 클래스 + 핸들러 미들웨어
  auth/
    verifySupabaseUser.ts   JWT 검증 (HS256 우선, JWKS 폴백)
    verifyInternalTask.ts   /tasks/* 내부 인증
  tenants/
    assertTenantRole.ts     has_tenant_role RPC 래퍼
  wallet/
    debitWallet.ts          debit_service_wallet RPC
    refundWallet.ts         refund_service_wallet RPC
    getActivePrice.ts       get_active_usage_price RPC
  logging/
    externalApiLog.ts       external_api_logs INSERT
  webhooks/
    storeWebhookEvent.ts    webhook_events 멱등 INSERT
  idempotency/
    makeKey.ts              idempotency 유틸
  validation/
    phone.ts                한국 휴대전화 정규화
    schemas.ts              zod 요청 스키마
  providers/
    types.ts                Provider 인터페이스
    aligo.ts                Real + Mock
    payssam.ts              Real(placeholder) + Mock
  messages/
    sendMessage.ts          전체 흐름 오케스트레이션
  invoices/
    createInvoice.ts        전체 흐름 오케스트레이션
  routes/
    health.ts
    messages.ts             POST /api/messages/send
    invoices.ts             POST /api/invoices/create
    webhooksPayssam.ts      POST /webhooks/payssam/payment-result
    tasksMessages.ts        POST /tasks/messages/process
```

## TODO (production 진입 전)

- [ ] Payssam 공식 API 명세 받아서 `providers/payssam.ts` 의 RealPayssamProvider 실 endpoint/필드 채우기
- [ ] Payssam webhook 서명 알고리즘 확인 후 `routes/webhooksPayssam.ts` 의 `verifyPayssamSignature` 구현
- [ ] Cloud Tasks OIDC 검증 — `auth/verifyInternalTask.ts` 의 `verifyOidcToken` 구현
- [ ] Sentry 통합 (workers/api 패턴 참고)
- [ ] Aligo 발송결과(DR) webhook 수신 — `/webhooks/aligo/dr` 추가
- [ ] rate-limit 미들웨어 (per tenant, per IP)

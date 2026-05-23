# 운영 가이드 (operations.md)

153OS 운영자가 알아야 할 모니터링·백업·장애 대응 절차.

## 1. 헬스체크

### 엔드포인트
- `GET /health` — 기본
- `GET /api/health` — alias (gateway 가 `/api/*` 만 라우팅하는 환경 대응)

### 응답
```json
{
  "success": true,
  "data": {
    "ok": true,
    "environment": "production",
    "version": "1.0.0-beta",
    "time": "2026-05-22T10:00:00.000Z"
  }
}
```

### 모니터링 권장
- BetterStack / uptime-kuma / Cloudflare Health Check 중 택1
- 주기: 1분
- 알림: 3회 연속 실패 시 Slack `#alerts` 채널
- 검사 기준: HTTP 200 + `data.ok === true`

## 2. Sentry (오류 추적)

### 현황
- 코드 통합 완료. **DSN 미설정 시 자동 no-op** (배포는 그대로 가능).
- CRM: `@sentry/react` — `apps/crm/src/lib/sentry.ts` 에서 init
- Workers: `@sentry/cloudflare` — `workers/api/src/index.ts` 에서 `Sentry.withSentry()` 래핑

### 활성화 절차
1. https://sentry.io → "153 Boxing OS" 프로젝트 2개 생성
   - `153-boxing-os-crm` (Platform: React)
   - `153-boxing-os-api` (Platform: Cloudflare Workers)
2. 각 프로젝트의 DSN 복사
3. **CRM**: Cloudflare Pages → 환경변수 `VITE_SENTRY_DSN` 등록 → 재배포
4. **Workers**: `wrangler secret put SENTRY_DSN` 으로 등록
5. 첫 배포 후 Sentry 대시보드에서 첫 이벤트 수신 확인

### 환경별 환경변수
| 변수 | 위치 | 비고 |
|---|---|---|
| `VITE_SENTRY_DSN` | Cloudflare Pages env | CRM. 빌드타임 주입 |
| `SENTRY_DSN` | Workers secret | API. 런타임 |
| `ENVIRONMENT` | Workers var | `development` / `staging` / `production` — Sentry 환경 태그 |

### 샘플링
- `tracesSampleRate: 0.1` (10% 성능 추적)
- 운영 부하 보면서 조절

## 3. DB 백업 (Supabase)

### 자동 백업 (무료/Pro 모두)
- **무료 플랜**: 매일 1회, 7일 보관
- **Pro 플랜**: 매일 1회, PITR(특정 시점 복구) 7일

### 확인 절차
1. Supabase Dashboard → Settings → Backups
2. 최근 백업 타임스탬프가 24시간 이내인지
3. 필요 시 `Download` 또는 `Restore` 가능

### 운영 권장
- **Pro 플랜 권장** — 출입 로그·결제 데이터 PITR 가능
- 분기 1회 복구 리허설 (스테이징 DB 로 restore 테스트)

## 4. 출입 시스템 장애 대응

### A. 단말기 1대 통신 두절
- 증상: `device_sync_jobs` 가 `failed` 상태로 누적
- 자동 알림: cron 5분 주기 `runAlertCheck` → `alerts` 테이블 + Slack
- CRM: `/admin/alerts` 페이지에서 확인
- 대응:
  1. 단말기 전원/네트워크 확인
  2. CRM → 장비 상세 → "강제 동기화" 버튼
  3. 그래도 실패 시 단말기 교체 + `/admin/emergency-pins` 로 임시 비상 PIN 발급

### B. CRM 전체 다운
- Cloudflare Pages 장애 가능성 — `status.cloudflare.com` 확인
- 일반적으로 5분 내 복구. **출입은 영향 없음** (단말기·CRM 분리 구조)

### C. Supabase DB 다운
- 모든 API 가 503 응답
- 단말기는 캐시된 권한으로 일정 시간 동작 가능
- 백업 복구 필요 시 Supabase 지원에 즉시 연락

### D. QR 발급 불가
- 원인: Workers QR_SIGNING_SECRET 미설정 또는 시간 동기화 오류
- 우회: 카운터 직원이 회원 신원 확인 후 비상 PIN 발급

## 5. 보안 점검 체크리스트 (월 1회)

- [ ] `access_logs` 백업 정상 (최근 7일 데이터 있음)
- [ ] `device_sync_jobs` 에 `failed` 30개 이상 누적된 단말기 없음
- [ ] `emergency_pins` 만료 미정리 (`status='active'` + `expires_at<now`) 없음
- [ ] Sentry 미해결 critical 이슈 없음
- [ ] Supabase 백업 최근 24시간 내
- [ ] CRM 사용자 계정 중 `last_login_at` 90일+ 인 계정 비활성화 검토

## 6. 배포 절차

### CRM (Cloudflare Pages)
- `main` 브랜치 push → 자동 배포
- preview: feature 브랜치 push → preview URL 자동 발급
- 환경변수 변경 시: Pages 대시보드에서 등록 후 **재배포 필요**

### Workers (Cloudflare Workers)
- `bun run --filter '@153/api' deploy` (수동)
- 또는 GitHub Actions 추가 권장
- secret 변경: `wrangler secret put NAME --env production`

### 마이그레이션 (Supabase)
- `supabase/migrations/*.sql` 에 새 파일 추가
- `supabase db push` 또는 Supabase Dashboard → SQL Editor 에서 실행
- **롤백 SQL 함께 작성**

## 7. 로그 보존 정책

| 테이블 | 보존 | 비고 |
|---|---|---|
| `access_logs` | 영구 | 출입 감사 — 삭제 금지 (CLAUDE.md 원칙) |
| `device_sync_jobs` | 90일 | 처리 완료된 success/failed 만 |
| `qr_used_tokens` | 1일 | TTL — `runQrCleanup` cron |
| `audit_logs` | 1년 | 관리자 행위 추적 |

## 8. 비상 연락처 양식 (운영 시 채우기)

```
- 본사 운영 책임자: ___
- 슈프리마 기술 지원: ___
- Cloudflare 계정 소유자: ___
- Supabase 계정 소유자: ___
```

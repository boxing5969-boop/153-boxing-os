# 06. 예상 위험요소

> Phase 1 산출물 #8 — 위험 식별 + 대응 방안
> 작성일: 2026-04-28

---

## 1. 위험 매트릭스 (P × I)

| ID | 위험 | 확률 | 영향 | 점수 | 대응 단계 |
|---|---|---|---|---|---|
| R-01 | Suprema/벤더 API 명세 미확정 → Phase 8 지연 | 높음 | 중 | 6 | Phase 1·7 |
| R-02 | Supabase 신규 프로젝트 권한/요금제 부족 | 중 | 높음 | 6 | Phase 3 |
| R-03 | RLS 우회 / 권한 누수 (지점 간 데이터 노출) | 중 | 매우높음 | 8 | Phase 3·7 |
| R-04 | QR 토큰 캡처 재사용 / 캡처 공유 | 중 | 높음 | 6 | Phase 4 |
| R-05 | 단말기 ↔ Workers HMAC 키 유출 | 낮 | 매우높음 | 6 | Phase 4 |
| R-06 | access_logs 변조 시도 | 낮 | 매우높음 | 6 | Phase 3 |
| R-07 | 동시성 — 같은 회원 여러 단말기에서 동시 진입 | 중 | 중 | 4 | Phase 4 |
| R-08 | 단말기 webhook 유실 → 로그 누락 | 중 | 중 | 4 | Phase 4·6 |
| R-09 | sync 작업 누적 실패 → 출입 권한 부정합 | 중 | 높음 | 6 | Phase 6 |
| R-10 | 만료 자정 cron 실패 → 만료 회원 출입 허용 | 낮 | 매우높음 | 6 | Phase 6 |
| R-11 | 얼굴 템플릿/생체정보 보호 (개인정보보호법) | 낮 | 매우높음 | 6 | Phase 0~8 |
| R-12 | 동의 철회 후 단말기에서 데이터 미삭제 | 중 | 매우높음 | 8 | Phase 6·8 |
| R-13 | 랭킹업앱 ↔ 153 BOXING OS API 인증 합의 미정 | 중 | 중 | 4 | Phase 4+ |
| R-14 | Cloudflare Workers 실행 시간/메모리 한계 | 낮 | 중 | 3 | Phase 4 |
| R-15 | 운영 시점 다중 지점 동시 장애 | 낮 | 매우높음 | 6 | Phase 8 |
| R-16 | 가맹점주 / 코치 / 본사 권한 갈등 (정책 변경) | 중 | 중 | 4 | Phase 5 |
| R-17 | 미납·정지 처리 정책 (유예기간 등) 미합의 | 높 | 중 | 6 | Phase 5·6 |

> 점수 9+ 는 즉시, 6~8 은 해당 Phase 에서, 4 이하는 모니터링.

---

## 2. 상세 — 우선순위 높음

### R-03 RLS 우회 / 권한 누수 (점수 8)

**시나리오:**
- 가맹점주가 service role key 노출된 클라이언트 코드 발견
- 코치가 SQL Editor 직접 접근하여 다른 지점 회원 조회
- public Storage 버킷에 회원 사진 노출

**대응:**
- Workers 만 service_role 사용. 클라이언트는 anon + JWT 만.
- RLS 정책 단위 테스트: Phase 7 에서 `branch_owner_A 가 branch_B 회원 조회 시도 → 0 row` 자동화.
- Storage 버킷 모두 `public=false` 기본. 회원 사진 등 민감 자산은 signed URL.
- 보안 감사 PR 체크리스트 (Phase 7 끝): 신규 RPC 추가 시 SECURITY DEFINER + 권한 가드 강제.

### R-12 동의 철회 후 단말기 데이터 미삭제 (점수 8)

**시나리오:** 회원이 안면인식 동의 철회 → CRM 은 처리했으나 단말기 얼굴 템플릿이 남음 → 개인정보보호법 위반.

**대응:**
- 동의 철회 RPC: `consent_records.revoked_at` 기록 + `device_sync_jobs(job_type='delete_user')` 자동 INSERT.
- `delete_user` 작업이 5회 재시도 후에도 실패 시 운영자 알림 (이메일/SMS/대시보드).
- 단말기 응답 OK 받은 후에야 CRM 측 `device_users` row 삭제.
- 분기별 감사 쿼리: `consent_records.revoked_at IS NOT NULL` 인 회원이 `device_users` 에 잔존하는지 확인.

---

## 3. 상세 — 점수 6

### R-01 Suprema/벤더 API 명세 미확정

**대응:**
- Phase 1~7 까지 MockDeviceAdapter 만으로 진행 가능하게 설계 (✅ 본 문서들이 이 방향).
- 계약 시점에 인터페이스 §2 만 SupremaAdapter 로 채우면 끝나도록 격리.
- 경쟁 벤더 (ZKTeco, Hikvision) 어댑터도 인터페이스 동일 → lock-in 회피.

### R-02 Supabase 신규 프로젝트 권한/요금제

**대응:**
- 결제 플랜 Pro 이상 (RLS · 백업 · 일일 활성 사용자 제한 회피).
- super_admin 계정으로 프로젝트 owner 권한 확보 (게임핏퀘스트의 Lovable 권한 이슈와 같은 함정 회피).
- `SUPABASE_ACCESS_TOKEN` 발급 + GitHub Actions secret 저장 → CI 에서 마이그레이션 자동 적용.

### R-04 QR 캡처 공유

**대응:**
- TTL 60초 (단축 가능)
- nonce + signature + 1회용 (Phase 4 KV 처리)
- 동일 IP 에서 동일 nonce 재시도 시 추가 거절 (사기 탐지)
- 캡처 화면 워터마크 (앱 측, 본 프로젝트 범위 외)

### R-05 HMAC 키 유출

**대응:**
- 단말기 키는 발급 시 1회 평문 노출, 이후 hash 저장.
- 키 회전 정책: 분기 1회 권장. 대시보드에 "키 회전" 버튼.
- 의심 트래픽 탐지: Workers 로그에서 timestamp 차이 큰 요청 모니터링.

### R-06 access_logs 변조

**대응:**
- DB 트리거로 UPDATE/DELETE 차단 (`access_logs_immutable()`).
- service_role 도 트리거에 막힘.
- 백업 분리: 일일 스냅샷 → R2 (read-only).

### R-09 sync 누적 실패

**대응:**
- retry_count 5 도달 시 device.status='error' + 대시보드 알림.
- "강제 동기화" 버튼으로 수동 재시도 (CLAUDE.md L271).
- 운영자 SLA: 1시간 내 응답 권장.

### R-10 자정 cron 실패

**대응:**
- 이중 cron: Cloudflare Cron Triggers + Supabase pg_cron (둘 중 하나만 살아있어도 동작).
- 실패 시 Discord/이메일 알림.
- 매일 09:00 에 헬스체크 cron 이 만료/sync 카운트 비정상 감지.

### R-11 생체정보 보호

**대응:**
- 얼굴 원본/템플릿은 단말기 또는 벤더 시스템에 보관, CRM 은 ID 와 동의 기록만 (CLAUDE.md L319-322).
- consent_records 에 동의 시점 + 약관 버전 기록.
- 개인정보처리방침 별도 작성 (Phase 5 와 함께).
- 분기별 보유 기간 점검: 탈퇴 회원의 잔존 데이터 자동 삭제 cron.

### R-15 다중 지점 동시 장애

**대응:**
- Cloudflare 자체 가용성에 의존 (자체 인프라 분리 부담 큼)
- 단말기 오프라인 모드: 마지막 동기화 시각 기준 캐시된 화이트리스트 로컬 보관 → 단말기가 일정 시간 자체 판단 (Phase 8+ 결정)
- 비상 PIN: 본사 운영팀 → 지점 관리자에게 SMS 로 1회용 PIN 발급 (CLAUDE.md L13)

### R-17 미납·정지 정책 미합의

**대응:**
- Phase 5 시작 전 본사 정책 문서화 (유예일, 자동 정지 일수, 안내 메시지).
- 정책은 코드 상수가 아니라 `policy_settings` 테이블로 분리 (운영자 변경 가능).

---

## 4. 점수 4 이하 — 모니터링 항목

### R-07 동시 진입
2개 단말기에서 한 회원이 동시 face match → 둘 다 success 가능. 운영상 큰 문제 아님 (한 사람이 두 단말기 동시 통과 불가). 모니터링만.

### R-08 webhook 유실
재시도 큐 + idempotency. Phase 4 설계 그대로 충분.

### R-13 랭킹업앱 연동 인증
Phase 4 진입 시 사용자와 협의. 옵션:
- **A.** partner secret + 해시된 회원 ID 매핑
- **B.** 양 시스템 모두 같은 OAuth 신뢰원 (Apple/Google) → JWT cross-validate
- **C.** 랭킹업앱 측이 153 BOXING OS Workers API 호출 시 단순 server-to-server API key

### R-14 Workers 한계
- 출입 verify: < 50ms 작업 → 충분
- sync queue 처리: 50건 batch / cron → 충분
- pull_logs 가 큰 페이로드 가능 → 페이지네이션 필수

### R-16 권한 정책 갈등
가맹점주가 본사 데이터 요구하거나 코치가 다른 코치 회원 조회 요구 가능. 정책 명문화 후 변경 시 마이그레이션 + 사용자 안내.

---

## 5. 운영 위험 (코드 외)

| 위험 | 대응 |
|---|---|
| 본 프로젝트 owner 1명 → bus factor | 핵심 운영자 2명 이상 super_admin 권한 |
| Supabase / Cloudflare 요금 폭증 | 월별 요금 알람 + 사용량 대시보드 |
| 단말기 분실/도난 | 분실 신고 시 즉시 device.status='inactive' + api_key 회전 |
| 직원 퇴사 → 권한 회수 누락 | profiles.status='inactive' 처리 + auth 비활성화 + 분기별 감사 |
| 회원 데이터 유출 사고 대응 | 사고 대응 매뉴얼 (개인정보보호위원회 신고 절차 포함) |

---

## 6. 위험 재평가 시점

- 각 Phase 종료 시: 새로운 위험 추가 + 기존 위험 점수 재산정
- 운영 시작 후: 분기 1회 정기 리뷰
- 사고 발생 시: 즉시 후속 위험 점수 상향

---

**다음 문서:** [07-phase2-files.md](./07-phase2-files.md) — Phase 2 에서 만들 파일 목록

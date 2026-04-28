# 153 BOXING OS — 운영 매뉴얼

> **대상**: 본사 관리자 / 가맹점주 / 지점 관리자 / 코치
> **버전**: v1.0 (Phase 0~15 기준)
> **PDF 생성**: `pandoc docs/operator-guide.md -o operator-guide.pdf` 또는 VS Code "Markdown PDF" 확장

---

## 0. 시작하기 전에

### 0.1 처음 로그인
1. 본사관리자가 발급한 이메일과 임시 비밀번호로 [CRM URL] 접속
2. 로그인 성공 → 대시보드 진입
3. 우상단 "설정" → 비밀번호 변경 (현재 미구현 — Supabase 직접 / 추후 추가)

### 0.2 화면 구성
- **좌측 사이드바**: 메뉴 (역할별로 다르게 보임)
- **상단 헤더**: 본인 이름·역할·로그아웃
- **메인 영역**: 선택한 메뉴의 콘텐츠

### 0.3 역할별 권한 요약
| 역할 | 회원 | 이용권 | 출입로그 | 장비 | 방문자 | 지점 | 직원 | 비상 PIN |
|---|---|---|---|---|---|---|---|---|
| super_admin | 전체 | 전체 | 전체 | 전체 | 전체 | 전체 | 전체 | 전체 |
| hq_admin | 전체 | 전체 | 전체 | 전체 | 전체 | 전체 | 전체 | 전체 |
| branch_owner | 자기 지점 | 자기 지점 | 자기 지점 | 자기 지점 | 자기 지점 | — | — | 자기 지점 |
| branch_manager | 자기 지점 | 자기 지점 | 자기 지점 | 자기 지점 | 자기 지점 | — | — | 자기 지점 |
| coach | 담당 회원 | — | 담당 회원 | — | — | — | — | — |

---

## 1. 일상 업무

### 1.1 신규 회원 등록

1. 좌측 메뉴 **회원** 클릭
2. 우상단 **신규 등록** 클릭
3. 입력:
   - 이름 (필수)
   - 전화번호 (선택, 자동 포맷)
   - 생년월일 (선택)
   - 성별 (선택 안함 / 남 / 여 / 기타)
   - 상태 (기본 "체험" — trial)
   - 지점 (super_admin/hq_admin 만 선택, 그 외 자동)
   - 담당 코치 (선택)
4. **등록** 클릭 → 자동으로 회원 상세로 이동

⚠ 등록만 하면 출입 권한이 없습니다. 이용권 또는 체험권 발급이 필요합니다.

### 1.2 이용권 등록 / 연장

1. 회원 상세 페이지에서 **이용권 등록** 버튼 클릭
2. 플랜 선택 (월간 30일 / 분기 90일 / 반기 180일 / 연간 365일)
3. 시작일 설정 (기본 오늘)
4. 결제 상태 (결제완료 / 부분결제 / 미납)
5. **등록** → 자동으로 단말기 동기화 작업 큐잉됨 (1분 내 처리)

🔁 **연장**: 기존 이용권을 그대로 두고 새 이용권을 등록하면 됨. 기간이 겹치면 verify 시 더 긴 쪽으로 통과.

### 1.3 체험권 발급

1. 회원 상세 → **체험권 발급**
2. 시작 일시 + 유효 기간 (일) + 최대 사용 횟수
3. 발급 → 즉시 동기화 작업 큐잉

전형적 사용:
- **1회권**: 1일 / 1회 — 시설 견학
- **3일권**: 3일 / 3회 — 단기 체험
- **1주권**: 7일 / 7회 — 등록 전 평가

### 1.4 미납 처리

1. 회원 이용권 행에서 **환불** 버튼 → 사유 확인
   ⛔ 또는 직접 SQL Editor 에서 `payment_status='unpaid'` 로 변경
2. 트리거가 자동으로:
   - `members.status = 'unpaid'` 갱신
   - 단말기 disable_user 작업 큐잉
3. 결제 완료 시:
   - `payment_status='paid'` 로 복구
   - 트리거가 자동으로 members 활성화 + update_user 큐잉

### 1.5 정지 / 환불 / 취소

회원 상세의 활성 이용권 행:
- **정지** — 일시 정지 (status='paused', 단말기 disable). 재활성은 새 이용권 등록 또는 직접 SQL.
- **환불** — payment_status='refunded' + status='canceled'. 환불 회계 처리는 별도.
- **취소** — status='canceled'. 환불 없는 단순 취소.

---

## 2. 출입 거절 대응

### 2.1 거절 사유별 회원 안내 문구

| 거절 사유 (시스템) | 회원에게 설명 | 직원 조치 |
|---|---|---|
| `expired_membership` | "이용권이 만료됐습니다." | 새 이용권 등록 권유 |
| `unpaid` | "이번 결제가 미납 상태입니다." | 결제 확인 후 payment_status='paid' |
| `suspended` | "현재 정지 상태입니다." | 사유 확인 후 새 이용권 등록 |
| `trial_max_used` | "체험권 사용 횟수를 다 쓰셨습니다." | 이용권 등록 권유 |
| `qr_expired` | "QR 코드가 만료됐어요. 앱에서 새로 발급 받으세요." | (앱 안내) |
| `qr_already_used` | "이 QR 은 이미 사용됐어요. 새로 발급 받으세요." | 앱에서 새 QR |
| `unknown_user` | "단말기에 등록되지 않았어요." | 회원 확인 + face 등록 / 비상 PIN |
| `device_error` | "단말기 통신 오류입니다." | 비상 PIN 발급 + 단말기 점검 |

### 2.2 비상 PIN 발급 (단말기 장애 / 본인 확인 불가)

1. 좌측 메뉴 **비상 PIN** 클릭
2. **PIN 발급**:
   - 지점 (자동/선택)
   - 사유 (감사 기록용 — "단말기 점검", "본인확인 불가" 등)
   - 유효 시간: 기본 10분 (1~1440 가능)
   - 최대 사용 횟수: 기본 1회 (1~100)
3. 6자리 PIN 노출 (1회) → **회원에게 직접 전달**
4. 회원이 단말기 PIN 입력 → 출입 + 감사 로그에 PIN ID + 발급자 기록

⚠ 발급된 PIN 은 다시 조회할 수 없습니다. 발급 후 즉시 전달하세요.
⚠ 의심스러운 사용 시 우측 **취소** 버튼으로 즉시 무효화 가능.

---

## 3. 단말기 운영

### 3.1 단말기 등록

1. 좌측 **장비** → 우상단 **장비 등록**
2. 입력:
   - 장비 이름 (예: "입구 얼굴인식기")
   - 종류 (얼굴인식 / QR 리더 / 카드 리더 / 릴레이 / 키오스크)
   - 벤더 (Mock = 개발/QA / Suprema / ZKTeco / Hikvision)
   - 시리얼·모델 (선택)
   - 벤더 API URL (Suprema 등 클라우드 단말기 시)
3. 등록 시 32-byte 키 자동 생성 + AES-GCM 암호화 저장
4. 평문 키 1회 노출 — **즉시 단말기 측에 입력**
5. 확인 체크 → 닫기

### 3.2 강제 동기화

회원의 출입 권한이 단말기에 반영 안 된 것 같을 때:
1. **장비** → 해당 단말기 행에서 **동기화** 클릭
2. 모든 매핑된 회원에 대해 update_user 작업 큐잉
3. failed 상태 작업 retry_count 0 으로 리셋
4. 1분 내 cron 이 처리

또는 **장비 상세** 페이지에서 동일 작업 + 작업 진행 상황 실시간 확인.

### 3.3 키 회전 (분기 1회 권장)

1. **장비** 행 → **키 회전** 클릭
2. 확인 → 새 32-byte 키 발급 + 단말기 측에 즉시 입력
3. 기존 키는 즉시 무효 — 갱신 전엔 단말기가 verify 호출 시 INVALID_SIGNATURE

### 3.4 단말기 상태 'error' 대응

`device.status='error'` 표시:
- 원인: 동기화 작업 5회 연속 실패 (자동 전환)
- 점검:
  1. 단말기 전원/네트워크 확인
  2. 벤더 API URL 확인 (Suprema 등)
  3. **장비 상세** → 동기화 작업 표 → error_message 확인
  4. 단말기 측 수동 점검 후 **강제 동기화** → 성공 시 자동으로 'active' 복구

### 3.5 단말기 분실 / 도난

1. SQL Editor (또는 추후 UI):
   ```sql
   UPDATE access_devices SET status='inactive' WHERE id='<device_id>';
   ```
2. 즉시 키 회전 (분실 단말기에 있던 키 무효화)
3. access_logs 에서 마지막 통신 시각 확인
4. 본사관리자 보고

---

## 4. 직원 관리

### 4.1 직원 초대 (super_admin / hq_admin)

1. 좌측 **직원** → 우상단 **직원 초대**
2. 입력: 이메일, 이름, 역할, 지점 (역할별 필수 여부 다름), 전화 (선택)
3. **초대 + 임시 비밀번호 발급**
4. **임시 비밀번호 1회 노출** → 본인에게 안전하게 전달 (Slack DM, 직접 대면 등)
5. 본인이 첫 로그인 후 비밀번호 변경 안내

⚠ super_admin 은 super_admin 만 발급 가능. hq_admin 은 super_admin 외 모든 역할 가능.

### 4.2 직원 권한 변경

UI 미구현. SQL Editor:
```sql
UPDATE profiles SET role='branch_owner', branch_id='<uuid>' WHERE id='<profile_id>';
```

### 4.3 퇴사 처리

```sql
UPDATE profiles SET status='inactive' WHERE id='<profile_id>';
-- 그리고 Supabase Dashboard → Authentication → 해당 사용자 비활성화 또는 삭제
```

분기별 감사: `SELECT * FROM profiles WHERE status='inactive'` 확인.

---

## 5. 동의 / 탈퇴

### 5.1 얼굴인식 동의 철회 (개인정보보호법 컴플라이언스)

1. 회원 상세 → **동의 관리** 카드
2. **얼굴인식** 행 → **철회** 클릭
3. 확인 (노란 경고: 단말기 자동 삭제 안내)
4. 트리거가 자동으로:
   - 등록된 모든 단말기에 delete_user 작업 큐잉
   - 1분 내 cron 처리 → 단말기에서 얼굴 템플릿 영구 삭제
   - device_users row 제거
5. CRM 응답에 sync_jobs_created 카운트 표시

### 5.2 회원 탈퇴

1. 회원 상태 → SQL Editor (UI 미구현):
   ```sql
   UPDATE members SET status='withdrawn' WHERE id='<member_id>';
   ```
2. 모든 동의 철회:
   - 동의 관리 카드에서 4개 항목 (얼굴/개인정보/마케팅/약관) 각각 철회
3. 잔여 데이터 보존 정책: access_logs 는 영구 보존 (감사). 개인정보는 분기별 cron 으로 익명화 (현재 미구현 — 향후 추가).

### 5.3 분기별 컴플라이언스 감사

```sql
-- 동의 철회된 회원 중 단말기에 데이터가 남아있는지 확인
SELECT m.id, m.name, du.device_id, du.vendor_user_id
FROM members m
JOIN device_users du ON du.member_id = m.id
WHERE EXISTS (
  SELECT 1 FROM consent_records cr
   WHERE cr.member_id = m.id
     AND cr.consent_type = 'face_recognition'
     AND cr.revoked_at IS NOT NULL
)
ORDER BY m.id;
-- 결과가 있으면 즉시 강제 동기화 (delete_user) 실행
```

---

## 6. 사고 대응

### 6.1 DB (Supabase) 응답 없음

증상: 모든 화면이 로딩 중 / 오류 표시.
조치:
1. status.supabase.com 확인
2. Supabase Dashboard → Project status 확인
3. 단말기는 자체 캐시로 일정 시간 동작 가능 (벤더에 따라 다름)
4. 장기 다운: super_admin 이 본사 운영팀에 SMS 비상 PIN 일괄 발급

### 6.2 단말기 전체 오프라인 (지점 1곳)

증상: `/devices` 의 해당 지점 단말기 모두 last_seen_at 정체.
조치:
1. 지점 네트워크 확인 (관장에게 연락)
2. 단말기 전원 재기동 안내
3. 단말기 측 수동 출입 모드 (벤더에 따라) 임시 활성화
4. 본사관리자 → 비상 PIN 발급 → SMS 로 회원에게 전송 가능 (현재 발급 후 SMS 자동 발송 미구현)

### 6.3 키 유출 의심

#### DEVICE_KMS_KEY (Workers 마스터 키)
영향: 모든 단말기 키 복호화 가능. **즉시 다음 절차**:
1. 모든 단말기 키 회전 (CRM `/devices` → 행마다 키 회전 — 또는 일괄 SQL)
2. 새 DEVICE_KMS_KEY 발급:
   ```bash
   openssl rand -base64 48 | bunx wrangler secret put DEVICE_KMS_KEY
   ```
3. 기존 암호문은 새 키로 복호화 불가 → access_devices.api_key_encrypted 컬럼 모두 NULL → 새 키 발급 필요
4. 사고 보고 + audit log 분석

#### PARTNER_API_KEY (랭킹업앱 연동 키)
영향: 다른 사용자의 153 회원 정보 조회 가능.
1. 즉시 회전:
   ```bash
   openssl rand -base64 48 | bunx wrangler secret put PARTNER_API_KEY
   ```
2. 랭킹업앱 측에 동일 키 갱신 요청
3. access_logs 의심 호출 분석

#### 단말기 api_key (개별)
1. CRM `/devices` → 키 회전
2. 단말기 측 새 키 입력

### 6.4 access_logs 의심 변조

access_logs 는 트리거로 UPDATE/DELETE 차단됨. 변조 시도 시 `is append-only` 에러.
이상 패턴:
- 동일 회원의 같은 시각 다중 success 로그 (실행 환경 외 자동 발급 의심)
- denied → success 가 빠르게 반복 (PIN brute force 의심)

조치:
1. raw_event_id, branch_id, device_id, occurred_at 으로 패턴 검색
2. 의심 device 의 키 회전 + status='inactive'
3. 본사관리자 보고

### 6.5 회원 데이터 유출 사고

1. **개인정보보호위원회 신고** (72시간 이내, 1만건 이상 또는 민감정보 포함 시)
2. 영향 회원에게 통지 (이메일 / SMS)
3. 사후 보고서 작성 — 사고 원인 / 시점 / 대응 / 재발 방지

---

## 7. 정기 점검

### 7.1 일간 (지점 매니저)
- 대시보드 위젯 4개 확인 (오늘 출입/거절/만료예정/sync 실패)
- 거절 건이 평소보다 많으면 거절 사유 카드 확인
- 단말기 동기화 실패 0 건인지 확인

### 7.2 주간 (본사 관리자)
- 만료 예정 7일 내 회원 목록 → 지점 매니저에게 안내 요청
- 거절 사유 분포 (최근 7일) → 비정상 패턴 확인
- 직원 변경 사항 / 비상 PIN 발급 이력 검토

### 7.3 월간 (본사 관리자)
- access_logs 백업 확인 (Supabase 자동 백업 + 별도 R2 export 권장)
- 미사용 직원 / 미연결 프로필 정리
- 단말기 펌웨어 / 어댑터 업데이트 검토

### 7.4 분기 (super_admin + 운영 책임자)
- DEVICE_KMS_KEY / PARTNER_API_KEY 회전 검토
- RLS 정책 우회 시도 테스트 (`docs/phase7-test-plan.md` §9~10)
- 단말기 키 일괄 회전 (보안 정책)
- 사고 대응 매뉴얼 업데이트

---

## 8. 빠른 참조

### 8.1 자주 쓰는 SQL (Supabase SQL Editor)

```sql
-- 활성 회원 수
SELECT count(*) FROM members WHERE status='active';

-- 만료 예정 7일 내
SELECT m.name, ms.plan_name, ms.end_date
  FROM memberships ms JOIN members m ON m.id = ms.member_id
 WHERE ms.status='active'
   AND ms.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days';

-- 오늘 거절 건수 (사유별)
SELECT denied_reason, count(*)
  FROM access_logs
 WHERE result='denied' AND occurred_at >= CURRENT_DATE
 GROUP BY denied_reason ORDER BY count(*) DESC;

-- 동기화 실패 작업
SELECT j.id, d.device_name, j.error_message, j.retry_count
  FROM device_sync_jobs j JOIN access_devices d ON d.id = j.device_id
 WHERE j.status='failed' ORDER BY j.created_at DESC;

-- 만료 일괄 처리 (자정 cron 이 자동 실행하지만 즉시 강제 시)
SELECT public.expire_outdated_memberships();
```

### 8.2 자주 묻는 질문

**Q. 회원이 등록 직후에 입장 시도했는데 거절돼요.**
A. 단말기 동기화에 1분 정도 걸립니다. `/devices/<id>` 에서 작업 큐 확인.

**Q. 가족 / 친구 회원권 양도 가능?**
A. 시스템은 1 회원 = 1 이용권. 양도 정책은 본사 운영 정책 따름. 필요 시 새 회원으로 등록.

**Q. 단말기 비밀번호 / api_key 잊어버렸어요.**
A. 다시 조회 불가. **키 회전** 으로 새 키 발급 후 단말기에 입력.

**Q. 직원이 비밀번호를 잊어버렸어요.**
A. 본사관리자가 Supabase Dashboard → Authentication → 해당 사용자 → "Send password recovery". 또는 새 임시 비번을 SQL 로 설정.

**Q. 코치가 다른 지점 회원을 봐야 해요.**
A. RLS 가 차단. 본사 관리자가 해당 회원의 `assigned_coach_id` 를 변경하거나, 코치 역할을 `branch_manager` 로 승격해야 함.

---

## 9. 비상 연락처

> 운영 시작 시 채워넣으세요.

- 본사 운영팀 (24/7 비상): [TBD]
- Supabase 지원: support@supabase.io
- Cloudflare 지원: dash.cloudflare.com → Help
- 단말기 벤더 (Suprema 한국): [TBD]
- 시스템 개발팀: [TBD]

---

**끝.** 본 매뉴얼은 분기별 업데이트. 마지막 갱신: 2026-04-29 (Phase 0~15 완료 시점).

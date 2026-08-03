# FC-4 인수인계 (얼굴 출석 — 문 제어 + 실차단 전환)

> 새 세션에서 "fc-4 시작해줘" 지시 시 이 문서 + 153os-dev·153os-design 스킬로 진행.
> (2026-08-03 2차 갱신: FC-5 + FC-4 1·2차(직원 통과) 완료 반영)

## FC-4 진행 현황 (2026-08-03)
- **1차 완료·라이브 검증**: 워커 verify 가 이용권(명부) 판단 **전에** access_grants(staff·admin_override, 기간·status 유효) 확인 → 통과 시 access_logs 에 `raw_event_id='staff_grant:<id>'` 로 구분 기록 후 즉시 allowed. 대표(이용희) staff grant 발급(9147a22a…, 무기한). 실측: 키오스크 정상 환영 + staff_grant 로그 2건 확인.
- **2차 완료(배포)**: 직원 통과 관리 UI — 워커 GET /enrollments 에 is_staff, POST /api/face-admin/staff-grant(지정=무기한 생성/해제=revoked, 본사=전지점·지점장=자기지점). CRM 등록현황 탭에 🛡 직원 배지 + [직원 지정]/[직원 해제] 토글. 배트: `_14-face-fc4-staff-deploy.bat`, `_15-face-fc4b-staff-ui-deploy.bat`.
- **3차 완료(실차단·2026-08-03)**: PILOT_SOFT=false 전환 + doorRelay 어댑터 스켈레톤(services/doorRelay.ts — noop 기본/mock/kreiser, env: DOOR_RELAY_PROVIDER·API_URL·API_KEY, verify allowed 시 waitUntil로 openDoorSafe). 크라이저 명세 오면 KreiserRelayAdapter.openDoor 내부 + wrangler secret만 채우면 됨.
- **boxer 검수(7 에이전트, 2026-08-03) 반영 완료** — 주요 수정:
  - 워커 verify: **등록 해제(동의 철회) 회원 서버측 최종 차단**(face_profiles.active 재확인 → denied consent_revoked. 켜진 키오스크 RAM 명단 창구 봉쇄), members 조회 deleted_at 필터, lookup 접미 일치(`%last4`), /list 오류 시 500(빈 명단 위장 금지)+삭제회원 제외, enroll 회원 존재 검증.
  - faceAdmin: 직원 해제가 admin_override도 revoke(판정·해제 대칭).
  - CRM: 로그 from 날짜 KST 파싱(FaceLogsTab·AccessLogsPage — 종전엔 KST 00~09시 로그 누락), consent_revoked 필터·라벨, 해제 실패 시 다이얼로그 닫아 에러 노출.
  - 키오스크: **호명 TTS를 판정 확정 후로 이동**(거절자에게 "환영합니다" 음성 방지), 거절 60초·실패 30초 재시도 백오프(무한 재인사 루프 제거, 결제 직후 재인식 가능), checkin 분리(부가 경로 실패가 원장 성공을 안 덮음), verify 401 시 키 재설정 플로우, 명단 로드 실패 시 오류 표시(빈 명단 위장 금지), 카메라 트랙 unmount 정리, 등록 시트 try/finally, 결과 확정 후 오버레이 표시시간 보장.
- **boxer 전수 검수 2회차(2026-08-03 밤, 7에이전트) — 반영 완료**
  - **CRITICAL 복구①**: 실차단 배포 직후 **얼굴 인식이 전면 정지**해 있었다. 유일한 등록자(대표) members 행이 `deleted_at`(2026-06-23) 상태였는데 같은 배포에서 `deleted_at` 필터를 추가해 `/list` 가 0명을 반환(라이브 실측). → 해당 행 `deleted_at=null` 복구. 교훈: **필터를 조이는 배포는 기존 등록자가 그 필터를 통과하는지 먼저 확인**할 것.
  - **CRITICAL 복구②(보안)**: `v_members_for_app_sync` 뷰가 SECURITY DEFINER + anon SELECT 였다 — 공개 anon 키만으로 회원 **3,195명 이름·전화·생년월일·누적결제액 전량 조회 가능**(anon 재현 확인). 백필로 노출 규모가 554→3,195명으로 커진 상태였다. → `security_invoker=on` + anon/authenticated 회수(마이그레이션 20260803144152·144253, 저장소 회수 완료). 함수는 PUBLIC 기본 EXECUTE 때문에 anon 개별 회수만으론 안 막힌다는 점도 확인.
  - 워커: 삭제 회원을 404 대신 **in-band 거절 + 감사 기록**(종전엔 로그가 한 줄도 안 남음), `access_logs.result` 를 사유가 아닌 **최종 판정(allowed)** 기준으로 기록(파일럿 사유는 raw_event_id `pilot_soft:*` 로 보존), insert 오류 콘솔 기록, 명단 1000행 절단 경고, `/enrollments` deleted_at 필터.
  - 키오스크: **통과음·호명을 판정 확정 후로** (거절자에게 성공음 나가던 문제), 응답이 4.5초를 넘어도 **거절 사유가 반드시 표시**(종전엔 소리만), `allowed === true` 부정 기본값, await 이후 유령 인식 차단, localStorage 안전 접근.
  - CRM: 직원 지정/해제에 **확인창**(무기한 출입 권한인데 원클릭이었음), 직원 배지가 회원상태를 덮지 않게, 손실방지 카드 문구 **"차단"→"거절 기록"**(문 제어 no-op인데 "시스템이 막았다"고 표기돼 있었음).
  - 오탐 기각 3건: `result='denied'` 0건(=거절 사건이 없었을 뿐), 키오스크 fail-open(응답 4경로 모두 allowed 명시), config.toml max_rows(미링크 로컬 템플릿). E 에이전트의 "거절률 85%·부당거절 389명"은 조건식 오독으로 폐기 → **실제 73.1%(2,334명), end_date NULL 384명은 오히려 통과(fail-open)**.
- **FC-6 다지점 확산 준비 완료(2026-08-03 심야)** — boxer 2회차 잔여 ⓐⓑ + H-3 해결.
  - **키가 지점을 결정한다**: `internal_config.face_kiosk_key:<branch_id>` 지점 키 4개 발급(선릉·역삼·잠실·칠금). 워커 미들웨어가 키→지점을 유도해 `c.set("kioskBranchId")`. 구형 공용 키 `face_kiosk_key` 는 전 지점 스코프로 **호환 유지**(현행 운영 무중단). 키오스크는 지점을 주장하지 않는다(위조 불가).
  - **로그·문열기 = 키오스크 지점**: verify 의 access_logs.branch_id 와 openDoorSafe 인자를 `kioskBranchId ?? m.branch_id` 로. 타지점 회원 방문은 `raw_event_id='cross_branch'` 로 표시. → 릴레이 연동 시 "타지점 문이 열리는" H-3 리스크 제거.
  - **명단 지점 스코프 + 페이징**: `/list`·`/enrollments` 를 `face_profiles → members!inner` 임베드 조인으로 바꿔 ①지점 필터를 서버에서 적용 ②`range()` 1000행 페이징(MAX_PAGES 8 = 약 2,600명)으로 **무음 절단 제거** ③`.in(ids)` URL 한도 회피. 종전엔 등록 약 333명부터 오류 없이 잘렸다.
  - **등록·조회 지점 제한**: 지점 키로는 그 지점 회원만 `/lookup` 조회·`/enroll` 등록 가능(403 OTHER_BRANCH). 유출된 키 1개로 전 지점에 얼굴을 심는 경로 차단.
  - **키오스크 오설정 감지**: `/list` 가 `branch_name` 을 돌려주고 상단에 `🔑 지점명` 표시 — URL 지점과 다르면 육안 즉시 식별. 배포 파일: `얼굴키오스크-지점별키-대외비.md`(키 배포용), 세팅 가이드 갱신.
- **남은 것**: ① 크라이저 릴레이 연동(회신 대기 — 어댑터 골격 준비됨) ④ **홀딩 정책 결정 대기**(HOLDING 3명 현재 통과 중 — 차단할지 대표 결정) ⑤ 선릉 active 1명 스냅샷 만료 대사(데스크 확인) ⑥ staff_grant 로그 멱등키(LOW).
- **boxer 2회차 잔여(다음 회차 우선순위)**: ⓐ~ⓑ(1000행 절단·키 분리)는 FC-6 에서 해결됨. 남은 보안 과제: `/enroll` 을 관리자 JWT 라우트로 이관 + 키당 rate limit(현재 지점 키라 피해 반경은 1개 지점) ⓒ 앱 Edge Function `face-kiosk` **소스가 저장소에 없음**(verify_jwt=false, config.toml 미선언 — CLI 재배포 시 무음 401 위험). 배포본 커밋 필요 ⓓ `get_daily_report_stats` 가 UTC 자정 기준이라 KST 00~09시 누락 → 문자 리포트 숫자와 CRM 화면 숫자가 다름 ⓔ 동의철회 트리거가 `face_profiles.active` 를 끄지 않음(정상 경로 /deactivate 는 끄므로 현 불일치 0건) ⓕ `net.*` anon EXECUTE 회수(현재 REST 도달 경로 없음) ⓖ 앱 checkin `already` 판정이 method 무관 — QR 과 이중 카운트 가능.
- 검수 판정 메모: face_profiles RLS는 "enabled+정책 0+비서비스롤 grant 0" = 의도된 전면 차단(오탐 기각). 실차단 직전 실측: 오늘 no_valid_grant 통과(파일럿) 5건 → 전환 후 거절로 바뀌는 규모.

## 완료 상태 (FC-1·2·3·5)
- FC-1·2 (운영 가동): 키오스크(웹) `/face-kiosk/:branchCode`(마이복서153 앱, face-api.js 온디바이스, 사진 비전송·128-d만). 워커 `/api/face/*`(x-kiosk-key = internal_config.face_kiosk_key). verify 판정 = member_snapshots(지점+전화) status/end_date. **PILOT_SOFT=true**(faceAccess.ts 상단) — 거절도 통과+사유 기록만.
- **FC-3 (2026-08-03 배포·검증)**: CRM 얼굴 출석 관리.
  - 워커 `routes/faceAdmin.ts` → `/api/face-admin/*` (requireJwt+역할, 키오스크 키와 분리): GET /enrollments(임베딩 미노출)·GET /logs(pilot_soft 플래그 반환)·POST /deactivate(active=false+동의 revoked_at). 본사=전지점+?branch_id / branch_owner·manager=자기 지점 강제.
  - CRM `/face-attendance`(등록현황/출입로그 2탭) + navConfig '얼굴 출석'(BRANCH_AND_HQ) + services/faceAttendance.ts.
- **키오스크 속도·환영 개선 (2026-08-03, 커밋 75e0e3d)**: 900ms 폴링→연속 루프, 탐지 224px, 웜업 추론, **매칭 즉시 환영**(verify·checkin은 백그라운드 확정), 시간대별 인사+TTS 이름 호명+차임벨(무음 토글 좌하단), 이용권 D-7 연장 안내. 랜드마크 68 풀모델 유지(기존 등록 호환).
- **FC-5 (2026-08-03 완료)**: 실회원 등록 확대 기반.
  - **members 백필**: member_snapshots→members, 역삼 339·잠실 309·칠금 2,000 = 2,648명(유효 이용권만 active, 나머지 expired, signup_source='manual', 전화 중복 제거·기존과 비충돌 exists 가드). 전 지점 합계 3,195명. members의 sync_member_to_app_aiu 트리거로 앱 미러 동기화 발생(정상).
  - **워커 lookup 확장성**(커밋 527b762e, 배포 완료): 전체 스캔 limit 2000 → 뒷 4자리 ilike 서버 필터+정규화 정확 대조. 동일 번호 다지점이면 최근 생성 우선.
  - **키오스크 등록 UX**(커밋 c0fd219, main 푸시 완료): 실시간 "얼굴 잡힘" 배지(디텍터만 160px 폴링), 3샷 각도 가이드(정면/좌/우), 생체정보 동의 고지 강화(수집·목적·철회·QR대안 4줄), 촬영 중복 방지·5샷 캡.
  - **지점 세팅 가이드**: 저장소 루트 `얼굴키오스크-지점세팅-가이드.md` (원장 전달용). 지점 코드: 잠실 jamsil · 역삼 yeoksam · 칠금 chilgeum (앱 DB whnczhxyjmyywhlfbgsd.branches.code).
- 배포 배트: 워커 `_13-face-fc5-deploy.bat` / 앱 `_face-enroll-ux-push.bat`(+로그형 재시도 `_0-fc5-push-retry.bat`).

## 함정 이력 (누적 — 반드시 읽기)
1. 신규 테이블은 `GRANT ALL … TO service_role` 필수 (빠지면 42501→401).
2. face_profiles 는 RLS 정책 없음 — CRM 접근은 반드시 `/api/face-admin` 경유.
3. 등록 해제·재등록은 키오스크가 목록 재로드(새로고침) 시 반영.
4. 워커 CORS: cors.ts (game-fit-quests.pages.dev 허용, X-Kiosk-Key 헤더).
5. **원격 세션에서 .git 내부 파일(refs·logs) 브리지 읽기는 캐시로 스테일할 수 있음** — 커밋/푸시 검증은 `_0-fc5-push-retry.bat`처럼 **git 출력을 로그 파일로 남겨 읽는 방식**이 정답. (FC-5에서 "커밋 없음" 오판 사례 있음 — 실제로는 성공해 있었음.)
6. 153-boxing-os 로컬 git 은 feature/messaging-playbooks-stage1 브랜치에서 커밋 중(배포는 wrangler라 무관).
7. PowerShell `cd /d` 불가, 마운트↔윈도우 동기화 지연 — 배치 실행 전 파일 도착 확인.

## FC-4 범위 (다음 세션)
1. 크라이저(문 제어 릴레이) 회신 오면 릴레이 연동 — verify allowed 로 개폐, AccessDeviceAdapter 추상화 유지.
2. **PILOT_SOFT=false 전환 검토** — faceAccess.ts 플래그 하나. 끄면 denied 실기록 + CRM 파일럿 배너 자동 소멸. 전환 전 /face-attendance 에서 등록·명부 매칭 최종 점검.
3. 거절 시 키오스크 문구·사운드 UX 점검(현재 낮은 톤 차임 + 사유 표시).

## 운영 실행 대기 (코드 아님)
- 잠실·역삼·칠금 확산: 가이드 전달 + 키오스크 키 공유(대표님이 문자로) + 기기 거치. DB·코드 준비는 끝.
- 선릉 실회원 등록 확대: 데스크 안내 시작하면 됨.

## 별건 (그대로)
- 브로제이 문의 발송 대기(웹훅·한도·WRITE·8/26 이후), 50분수업-새틀.md 승인 대기, 브로제이 축소는 등록 확대 성과 본 뒤 판단.

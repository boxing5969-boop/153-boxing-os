# Aligo → NAVER Cloud SENS 마이그레이션 가이드

Phase 1 라이브 SMS 발송은 **NAVER Cloud Platform SENS** 를 사용한다.
알리고는 IP 화이트리스트 요구로 Cloudflare Workers 와 부적합하여 제외 (CLAUDE.md 결정 6~9 + Phase 1 문자 정책 참고).

## 서비스 개요
- 서비스명: Simple & Easy Notification Service (SENS)
- 공식 페이지: https://www.ncloud.com/product/aiService/sens
- 콘솔: https://console.ncloud.com/sens/project
- API 문서: https://api.ncloud-docs.com/docs/sens-project-list

## 필요한 인증 정보

| 키 | 설명 | 153 OS 저장 위치 |
|---|---|---|
| `NCP_ACCESS_KEY` | IAM Access Key | `branches.kakao_api_key_enc` (암호화) |
| `NCP_SECRET_KEY` | IAM Secret Key (서명 생성용) | `branches.kakao_api_secret_enc` (암호화) |
| `NCP_SENS_SERVICE_ID` | SMS 서비스 ID (예: `ncp:sms:kr:xxxxx:서비스명`) | `branches.kakao_pfid` (평문 — 식별자라 암호화 불필요) |
| `NCP_SENS_FROM` | 발신번호 (사전 등록 필요) | `branches.sms_sender_phone` |

> 153 OS는 멀티테넌트라 인증정보를 지점별로 DB에 저장한다. `.dev.vars.example` 의 NCP_* 변수는 문서·로컬 개발용이며 운영 코드는 branches 테이블에서 읽는다.

## API 엔드포인트 베이스

```
https://sens.apigw.ntruss.com
```

## 공통 요청 헤더

| 헤더 | 값 |
|---|---|
| `Content-Type` | `application/json; charset=utf-8` |
| `x-ncp-apigw-timestamp` | Unix Timestamp (ms 단위 문자열) |
| `x-ncp-iam-access-key` | Access Key |
| `x-ncp-apigw-signature-v2` | HMAC-SHA256 서명 (Base64) |

## 서명(Signature) 생성 규칙

```
message = METHOD + " " + URI + "\n"
        + timestamp + "\n"
        + accessKey

signature = Base64( HMAC-SHA256(secretKey, message) )
```

153 OS 구현: `workers/api/src/services/sensClient.ts` 의 `buildSignature()`.

## 프로젝트 목록 조회 (참고)

```
GET /common/v2/projects
```

- Query: `projectName`(opt), `pageSize`(1~100), `pageIndex`(0~N)
- 응답 주요 필드: `projectId`, `projectName`, `smsService.serviceId` 등

## SMS 발송 (사용 중)

```
POST /sms/v2/services/{serviceId}/messages
```

Body 예:

```json
{
  "type": "SMS",
  "from": "발신번호",
  "content": "기본 내용",
  "messages": [{ "to": "수신번호", "content": "내용" }]
}
```

- `type`: `SMS` | `LMS` | `MMS`
- 153 OS는 본문 바이트 길이로 자동 분기 (90byte 초과 시 LMS)

## 153 OS 구현 위치

- 클라이언트: `workers/api/src/services/sensClient.ts`
- 발송 래퍼: `workers/api/src/services/smsNotifier.ts` (시그니처 유지 — 기존 호출부 무수정)
- 단위 테스트: `workers/api/test/sensClient.test.ts`
- 카카오 알림톡: Phase 1 disabled — Phase 2 재개 시 SENS Alimtalk 으로 이전 검토

## Phase 1 정책 (CLAUDE.md 참고)
- `MESSAGE_PROVIDER=aligo` 금지, `ALIGO_ENABLED=true` 금지
- 알리고 라이브 발송 경로 호출 금지
- Cloud Run / Cloud NAT / 고정 IP 인프라 main 배포 금지

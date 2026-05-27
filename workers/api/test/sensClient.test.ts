/**
 * NCP SENS 클라이언트 단위 테스트
 *
 * - 발신/수신번호 정규화·검증
 * - HMAC-SHA256 서명 생성 (NCP API Gateway 규격)
 * - 메시지 타입 자동 분기 (SMS/LMS)
 *
 * 실제 HTTP 호출(sendSensSms)은 단위테스트에서 검증하지 않는다
 * (네트워크·외부 인증 의존이라 통합테스트로 분리하는 것이 적절).
 */

import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  isValidPhone,
  calcEucKrBytes,
  inferMessageType,
  buildSignature,
} from "../src/services/sensClient";

describe("normalizePhone", () => {
  it("하이픈 제거", () => {
    expect(normalizePhone("010-1234-5678")).toBe("01012345678");
  });

  it("공백·괄호 제거", () => {
    expect(normalizePhone("(010) 1234-5678")).toBe("01012345678");
    expect(normalizePhone("010 1234 5678")).toBe("01012345678");
  });

  it("국제번호 + · - 제거", () => {
    expect(normalizePhone("+82-10-1234-5678")).toBe("821012345678");
  });

  it("이미 정규화된 번호는 그대로", () => {
    expect(normalizePhone("01012345678")).toBe("01012345678");
  });

  it("빈 문자열은 빈 문자열", () => {
    expect(normalizePhone("")).toBe("");
  });

  it("null/undefined 같은 잘못된 입력도 안전하게 처리", () => {
    // 타입상 string 이지만 런타임 안전성 확인
    expect(normalizePhone(null as unknown as string)).toBe("");
    expect(normalizePhone(undefined as unknown as string)).toBe("");
  });
});

describe("isValidPhone", () => {
  it("정상 한국 휴대폰 번호 — 유효", () => {
    expect(isValidPhone("010-1234-5678")).toBe(true);
    expect(isValidPhone("01012345678")).toBe(true);
    expect(isValidPhone("0212345678")).toBe(true); // 서울 일반전화
  });

  it("국제번호 — 유효", () => {
    expect(isValidPhone("+82-10-1234-5678")).toBe(true);
  });

  it("너무 짧으면 무효", () => {
    expect(isValidPhone("123")).toBe(false);
    expect(isValidPhone("01012345")).toBe(false); // 8자리
  });

  it("너무 길어도 무효", () => {
    expect(isValidPhone("0".repeat(16))).toBe(false);
  });

  it("빈 문자열·null 무효", () => {
    expect(isValidPhone("")).toBe(false);
    expect(isValidPhone(null as unknown as string)).toBe(false);
  });
});

describe("calcEucKrBytes", () => {
  it("ASCII 1byte, 한글 2byte", () => {
    expect(calcEucKrBytes("abc")).toBe(3);
    expect(calcEucKrBytes("가나다")).toBe(6);
    expect(calcEucKrBytes("Hello 한글")).toBe(10); // "Hello "=6 (ASCII) + "한글"=4 (2byte×2)
  });

  it("빈 문자열은 0", () => {
    expect(calcEucKrBytes("")).toBe(0);
  });
});

describe("inferMessageType", () => {
  it("90byte 이하는 SMS", () => {
    expect(inferMessageType("안녕")).toBe("SMS");
    expect(inferMessageType("a".repeat(90))).toBe("SMS");
  });

  it("90byte 초과는 LMS", () => {
    expect(inferMessageType("a".repeat(91))).toBe("LMS");
    expect(inferMessageType("가".repeat(46))).toBe("LMS"); // 92byte
  });
});

describe("buildSignature", () => {
  // NCP API Gateway 규격:
  //   message = METHOD + " " + URI + "\n" + timestamp + "\n" + accessKey
  //   signature = Base64( HMAC-SHA256(secretKey, message) )
  //
  // 동일 입력에 대해 결정적(deterministic) 결과를 내야 한다.

  const METHOD = "POST";
  const URI = "/sms/v2/services/ncp:sms:kr:1234:test/messages";
  const TIMESTAMP = "1700000000000";
  const ACCESS_KEY = "test-access-key";
  const SECRET_KEY = "test-secret-key";

  it("동일 입력에 대해 결정적인 결과를 낸다", async () => {
    const sig1 = await buildSignature(METHOD, URI, TIMESTAMP, ACCESS_KEY, SECRET_KEY);
    const sig2 = await buildSignature(METHOD, URI, TIMESTAMP, ACCESS_KEY, SECRET_KEY);
    expect(sig1).toBe(sig2);
  });

  it("Base64 형식의 문자열을 반환한다", async () => {
    const sig = await buildSignature(METHOD, URI, TIMESTAMP, ACCESS_KEY, SECRET_KEY);
    // Base64: A-Z a-z 0-9 + / = 만 허용
    expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/);
    // HMAC-SHA256 결과는 32byte → Base64 인코딩 시 항상 44자 (44 = ceil(32/3)*4)
    expect(sig.length).toBe(44);
  });

  it("secretKey 가 다르면 서명도 달라진다", async () => {
    const a = await buildSignature(METHOD, URI, TIMESTAMP, ACCESS_KEY, "secret-A");
    const b = await buildSignature(METHOD, URI, TIMESTAMP, ACCESS_KEY, "secret-B");
    expect(a).not.toBe(b);
  });

  it("timestamp 가 다르면 서명도 달라진다", async () => {
    const a = await buildSignature(METHOD, URI, "1000000000000", ACCESS_KEY, SECRET_KEY);
    const b = await buildSignature(METHOD, URI, "2000000000000", ACCESS_KEY, SECRET_KEY);
    expect(a).not.toBe(b);
  });

  it("URI 가 다르면 서명도 달라진다", async () => {
    const a = await buildSignature(METHOD, "/sms/v2/services/A/messages", TIMESTAMP, ACCESS_KEY, SECRET_KEY);
    const b = await buildSignature(METHOD, "/sms/v2/services/B/messages", TIMESTAMP, ACCESS_KEY, SECRET_KEY);
    expect(a).not.toBe(b);
  });

  it("알려진 입력에 대해 정확한 HMAC-SHA256 Base64 값을 반환한다", async () => {
    // 참조값: Python `hmac.new(b'mySecretKey', b'POST /test\n123\nmyAccessKey', sha256).digest()` 의 Base64
    // 메시지: "POST /test\n123\nmyAccessKey"
    // 시크릿: "mySecretKey"
    const sig = await buildSignature(
      "POST",
      "/test",
      "123",
      "myAccessKey",
      "mySecretKey",
    );
    // 결정적 출력이므로 한 번 계산된 값을 고정값으로 검증
    // (값이 잘못되었다고 의심되면 별도 도구로 재계산해 비교)
    expect(sig).toBe("rdZ4wuwCM0kpmunDiigkQ7m+uYWNWbv8WuI/cEgrCsA=");
  });
});

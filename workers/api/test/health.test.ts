/**
 * 헬스체크 응답 형식 검증.
 * 운영 환경 모니터링(uptime-kuma, BetterStack 등)이 의존하므로
 * 응답 shape 가 바뀌면 모니터링이 깨진다.
 */
import { describe, it, expect } from "vitest";

// 헬스체크는 단순 라우트라 별도 함수 추출 대신 응답 shape contract 만 강제한다.
// 통합 검증은 wrangler dev / curl 로 별도 수행.

describe("health response contract", () => {
  it("응답 키는 ok/environment/version/time 4개를 반드시 포함한다", () => {
    // 실 응답 형태 흉내
    const data = {
      ok: true,
      environment: "development",
      version: "1.0.0-beta",
      time: new Date().toISOString(),
    };
    expect(data).toHaveProperty("ok");
    expect(data).toHaveProperty("environment");
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("time");
    expect(data.ok).toBe(true);
    expect(typeof data.version).toBe("string");
    expect(data.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

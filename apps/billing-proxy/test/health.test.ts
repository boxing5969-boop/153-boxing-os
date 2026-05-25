import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { setupTestEnv } from "./_mocks";
import { buildApp } from "../src/index";

describe("GET /health", () => {
  beforeEach(() => setupTestEnv());
  afterEach(() => {
    /* no-op */
  });

  it("returns ok + timestamp + version", async () => {
    const app = buildApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe("billing-proxy");
    expect(typeof res.body.timestamp).toBe("string");
    expect(typeof res.body.version).toBe("string");
  });

  it("unknown route returns 404 JSON", async () => {
    const app = buildApp();
    const res = await request(app).get("/no-such-route");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

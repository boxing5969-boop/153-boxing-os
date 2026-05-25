import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSupabase, injectSupabase, makeMockSupabase, setupTestEnv } from "./_mocks";
import { storeWebhookEvent, markWebhookProcessed } from "../src/webhooks/storeWebhookEvent";

describe("storeWebhookEvent", () => {
  beforeEach(() => setupTestEnv());
  afterEach(() => clearSupabase());

  it("new event — inserts and returns alreadyExisted=false", async () => {
    injectSupabase(
      makeMockSupabase({
        table: ({ tableName, op }) => {
          if (tableName === "webhook_events" && op === "select") {
            return { data: null, error: null }; // not found
          }
          if (tableName === "webhook_events" && op === "insert") {
            return { data: { id: "wh-1", processed: false }, error: null };
          }
          return { data: null, error: null };
        },
      })
    );
    const r = await storeWebhookEvent({
      provider: "payssam",
      externalEventId: "evt-001",
      payload: { foo: "bar" },
    });
    expect(r.alreadyExisted).toBe(false);
    expect(r.id).toBe("wh-1");
    expect(r.processed).toBe(false);
  });

  it("duplicate external_event_id — returns alreadyExisted=true without insert", async () => {
    let insertAttempted = false;
    injectSupabase(
      makeMockSupabase({
        table: ({ tableName, op }) => {
          if (tableName === "webhook_events" && op === "select") {
            return { data: { id: "wh-existing", processed: true }, error: null };
          }
          if (tableName === "webhook_events" && op === "insert") {
            insertAttempted = true;
            return { data: { id: "wh-new", processed: false }, error: null };
          }
          return { data: null, error: null };
        },
      })
    );
    const r = await storeWebhookEvent({
      provider: "payssam",
      externalEventId: "evt-001",
      payload: { foo: "bar" },
    });
    expect(r.alreadyExisted).toBe(true);
    expect(r.id).toBe("wh-existing");
    expect(r.processed).toBe(true);
    expect(insertAttempted).toBe(false);
  });

  it("markWebhookProcessed updates row without throwing", async () => {
    injectSupabase(
      makeMockSupabase({
        table: () => ({ data: null, error: null }),
      })
    );
    await expect(markWebhookProcessed("wh-1")).resolves.toBeUndefined();
  });
});

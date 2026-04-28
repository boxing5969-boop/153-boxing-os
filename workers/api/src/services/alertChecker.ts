import { getServiceClient } from "../lib/supabase";
import { sendSlackAlert, type SlackAlertPayload } from "./slackNotifier";
import type { Env } from "../lib/env";

interface PendingAlert {
  alert_id: string;
  kind: string;
  severity: string;
  subject: string;
  details: Record<string, unknown> | null;
  branch_id: string | null;
  device_id: string | null;
}

export interface AlertCheckReport {
  detected: number;
  notified: number;
  failed: number;
}

export async function runAlertCheck(env: Env): Promise<AlertCheckReport> {
  const db = getServiceClient(env);
  const { data, error } = await db.rpc("run_alert_check");
  if (error) {
    console.error("[alertCheck] rpc failed", error);
    return { detected: 0, notified: 0, failed: 0 };
  }

  const alerts = (data ?? []) as unknown as PendingAlert[];
  if (alerts.length === 0) {
    return { detected: 0, notified: 0, failed: 0 };
  }

  let notified = 0;
  let failed = 0;
  const webhook = env.SLACK_WEBHOOK_URL;

  for (const a of alerts) {
    if (!webhook) {
      // 웹훅 미설정 — 알림 사실만 기록 후 mark_notified 처리 (재발송 방지)
      await db.rpc("mark_alert_notified", { _alert_id: a.alert_id });
      continue;
    }
    try {
      const payload: SlackAlertPayload = {
        kind: a.kind,
        severity: a.severity,
        subject: a.subject,
        details: a.details ?? {},
        branch_id: a.branch_id,
        device_id: a.device_id,
      };
      await sendSlackAlert(webhook, payload);
      await db.rpc("mark_alert_notified", { _alert_id: a.alert_id });
      notified++;
    } catch (err) {
      failed++;
      console.error("[alertCheck] notify failed", a.alert_id, err);
    }
  }

  return { detected: alerts.length, notified, failed };
}

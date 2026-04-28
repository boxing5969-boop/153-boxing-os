type AlertSeverity = "info" | "warning" | "critical";
type AlertKind = "device_offline" | "device_error" | "sync_backlog";

export interface SlackAlertPayload {
  kind: AlertKind | string;
  severity: AlertSeverity | string;
  subject: string;
  details: Record<string, unknown>;
  branch_id?: string | null;
  device_id?: string | null;
}

const SEVERITY_EMOJI: Record<string, string> = {
  info: ":information_source:",
  warning: ":warning:",
  critical: ":rotating_light:",
};

const KIND_LABELS: Record<string, string> = {
  device_offline: "단말기 통신 두절",
  device_error: "단말기 오류 상태",
  sync_backlog: "동기화 작업 누적",
};

export async function sendSlackAlert(
  webhookUrl: string,
  alert: SlackAlertPayload
): Promise<void> {
  const emoji = SEVERITY_EMOJI[alert.severity] ?? ":bell:";
  const kindLabel = KIND_LABELS[alert.kind] ?? alert.kind;
  const text = `${emoji} *${kindLabel}* — ${alert.subject}`;
  const detailsLine = Object.entries(alert.details)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ");

  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text },
    },
  ];
  if (detailsLine) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `_${detailsLine}_` }],
    });
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, blocks }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook ${res.status}: ${body.slice(0, 200)}`);
  }
}

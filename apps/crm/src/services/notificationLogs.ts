import { supabase } from "@/integrations/supabase/client";

export interface NotificationLog {
  id: string;
  member_id: string;
  membership_id: string | null;
  notification_type: string;
  sent_at: string;
  status: "sent" | "failed";
  error_message: string | null;
  recipient_phone: string | null;
  // joined
  member_name: string | null;
  branch_name: string | null;
}

export interface GetNotificationLogsParams {
  status?: "sent" | "failed" | "all";
  limit?: number;
  offset?: number;
}

export async function getNotificationLogs(
  params: GetNotificationLogsParams = {}
): Promise<NotificationLog[]> {
  const { status = "all", limit = 100, offset = 0 } = params;

  let query = supabase
    .from("membership_notifications")
    .select(`
      id,
      member_id,
      membership_id,
      notification_type,
      sent_at,
      status,
      error_message,
      recipient_phone,
      members!inner(name, branches!inner(name))
    `)
    .order("sent_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown[]).map((row: unknown) => {
    const r = row as {
      id: string;
      member_id: string;
      membership_id: string | null;
      notification_type: string;
      sent_at: string;
      status: "sent" | "failed";
      error_message: string | null;
      recipient_phone: string | null;
      members: { name: string; branches: { name: string } };
    };
    return {
      id: r.id,
      member_id: r.member_id,
      membership_id: r.membership_id,
      notification_type: r.notification_type,
      sent_at: r.sent_at,
      status: r.status,
      error_message: r.error_message,
      recipient_phone: r.recipient_phone,
      member_name: r.members?.name ?? null,
      branch_name: r.members?.branches?.name ?? null,
    };
  });
}

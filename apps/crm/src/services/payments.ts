import { supabase } from "@/integrations/supabase/client";

export interface PaymentRequest {
  id: string;
  amount: number;
  description: string;
  status: "pending" | "paid" | "cancelled" | "expired";
  payssam_bill_url: string | null;
  due_date: string | null;
  paid_at: string | null;
  sent_via: string;
  trigger_type: string | null;
  created_at: string;
}

export async function getPaymentRequests(memberId: string): Promise<PaymentRequest[]> {
  const { data, error } = await supabase
    .from("payment_requests")
    .select("id, amount, description, status, payssam_bill_url, due_date, paid_at, sent_via, trigger_type, created_at")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return (data ?? []) as PaymentRequest[];
}

export interface SendBillPayload {
  member_id: string;
  membership_id?: string;
  amount: number;
  description: string;
  due_date?: string;
  recipient_phone: string;
  sent_via: "sms" | "kakao" | "both";
}

export async function sendPaymentBill(payload: SendBillPayload): Promise<{ payment_request_id: string; bill_url: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
  const res = await fetch(`${apiBase}/api/payments/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: "서버 오류" } })) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? "청구서 발송 실패");
  }

  const json = await res.json() as { data: { payment_request_id: string; bill_url: string | null } };
  return json.data;
}

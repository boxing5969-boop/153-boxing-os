import { supabase } from "@/integrations/supabase/client";
import type { PaymentStatus } from "@153/shared";

export interface RevenueSummary {
  from: string;
  to: string;
  branch_id: string | null;
  paid_total: number;
  partial_total: number;
  unpaid_total: number;
  refunded_total: number;
  paid_count: number;
  partial_count: number;
  unpaid_count: number;
  refunded_count: number;
  total_count: number;
}

export interface RevenueDailyRow {
  day: string;
  paid_total: number;
  partial_total: number;
  unpaid_total: number;
  refunded_total: number;
  paid_count: number;
  total_count: number;
}

export interface OutstandingPaymentRow {
  membership_id: string;
  member_id: string;
  member_name: string;
  branch_id: string;
  plan_name: string;
  start_date: string;
  end_date: string;
  payment_status: PaymentStatus;
  price: number | null;
  days_since_start: number;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export async function getRevenueSummary(
  from: string,
  to: string,
  branchId: string | null = null
): Promise<RevenueSummary> {
  const { data, error } = await supabase.rpc("get_revenue_summary", {
    _from: from,
    _to: to,
    _branch_id: branchId,
  });
  if (error) throw error;
  const raw = data as Record<string, unknown>;
  return {
    from: String(raw.from ?? from),
    to: String(raw.to ?? to),
    branch_id: (raw.branch_id as string | null) ?? null,
    paid_total: toNumber(raw.paid_total),
    partial_total: toNumber(raw.partial_total),
    unpaid_total: toNumber(raw.unpaid_total),
    refunded_total: toNumber(raw.refunded_total),
    paid_count: toNumber(raw.paid_count),
    partial_count: toNumber(raw.partial_count),
    unpaid_count: toNumber(raw.unpaid_count),
    refunded_count: toNumber(raw.refunded_count),
    total_count: toNumber(raw.total_count),
  };
}

export async function getRevenueDaily(
  from: string,
  to: string,
  branchId: string | null = null
): Promise<RevenueDailyRow[]> {
  const { data, error } = await supabase.rpc("get_revenue_daily", {
    _from: from,
    _to: to,
    _branch_id: branchId,
  });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    day: String(r.day),
    paid_total: toNumber(r.paid_total),
    partial_total: toNumber(r.partial_total),
    unpaid_total: toNumber(r.unpaid_total),
    refunded_total: toNumber(r.refunded_total),
    paid_count: toNumber(r.paid_count),
    total_count: toNumber(r.total_count),
  }));
}

export async function getOutstandingPayments(
  branchId: string | null = null
): Promise<OutstandingPaymentRow[]> {
  const { data, error } = await supabase.rpc("get_outstanding_payments", {
    _branch_id: branchId,
  });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    membership_id: String(r.membership_id),
    member_id: String(r.member_id),
    member_name: String(r.member_name ?? "—"),
    branch_id: String(r.branch_id),
    plan_name: String(r.plan_name),
    start_date: String(r.start_date),
    end_date: String(r.end_date),
    payment_status: r.payment_status as PaymentStatus,
    price: r.price === null || r.price === undefined ? null : toNumber(r.price),
    days_since_start: toNumber(r.days_since_start),
  }));
}

/** CSV 클라이언트 다운로드 (BOM 포함 UTF-8 — Excel 한글 호환) */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    alert("내보낼 데이터가 없습니다.");
    return;
  }
  const headers = Object.keys(rows[0] as object);
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape((r as Record<string, unknown>)[h])).join(",")),
  ];
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

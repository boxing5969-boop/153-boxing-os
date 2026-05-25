/**
 * get_active_usage_price RPC 호출 래퍼.
 * 활성 단가가 없으면 null 반환.
 */
import { getSupabase } from "../lib/supabase";
import { AppError } from "../lib/errors";

export interface ActiveUsagePrice {
  usageType: string;
  costKrw: number;
  chargeKrw: number;
}

export async function getActivePrice(usageType: string): Promise<ActiveUsagePrice | null> {
  const supa = getSupabase();
  const { data, error } = await supa.rpc("get_active_usage_price", { p_usage_type: usageType });
  if (error) {
    throw new AppError("DB_ERROR", `get_active_usage_price failed: ${error.message}`, 500);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const r = row as Record<string, unknown>;
  return {
    usageType: String(r.usage_type),
    costKrw: Number(r.cost_krw),
    chargeKrw: Number(r.charge_krw),
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";

// 완전 자동화 유료 구독 게이트.
// 지점이 status='active' 이고 유효기간(valid_until)이 남아있으면 true.
// valid_until 이 null 이면 무기한 활성.
export async function isPremium(db: SupabaseClient, branchId: string): Promise<boolean> {
  if (!branchId) return false;
  const { data } = await db
    .from("branch_subscriptions")
    .select("status, valid_until")
    .eq("branch_id", branchId)
    .maybeSingle();
  const row = data as { status: string; valid_until: string | null } | null;
  if (!row || row.status !== "active") return false;
  if (row.valid_until) {
    const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    if (row.valid_until < todayKst) return false;
  }
  return true;
}

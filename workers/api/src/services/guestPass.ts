/**
 * 게스트 초대권 발급 — 온보딩 자동문자와 지점 수동 발급이 함께 쓰는 단일 경로.
 *
 * ⚠️ 같은 회원에게 계속 새 초대권이 쌓이면 안 된다. 아직 안 쓴 초대권이 있으면 그것을 다시 준다.
 *    (자동 발송이 중복 실행되거나, 회원이 링크를 잃어버려 다시 요청하는 경우 모두 이 규칙으로 안전해진다)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const PASS_VALUE_WON = 30000;
/** 유효기간 — 기한이 없으면 계속 미루게 된다 */
export const PASS_VALID_DAYS = 30;

function slug8(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}
function digits(p: string | null | undefined): string {
  return (p ?? "").replace(/\D/g, "");
}
function kstDatePlus(days: number): string {
  return new Date(Date.now() + 9 * 3600 * 1000 + days * 86400000).toISOString().slice(0, 10);
}

export interface IssuedPass { id: string; slug: string; valid_until: string | null; value_won: number }

export async function issueGuestPass(
  db: SupabaseClient,
  opts: { branchId: string; name: string | null; phone: string | null; source: "onboarding" | "manual" },
): Promise<IssuedPass | null> {
  const phone = digits(opts.phone);

  // 아직 안 쓴 초대권이 있으면 재사용
  if (phone) {
    const { data: prev } = await db.from("guest_passes")
      .select("id, slug, valid_until, value_won")
      .eq("branch_id", opts.branchId).eq("issuer_phone", phone).eq("status", "issued")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (prev) return prev as IssuedPass;
  }

  const { data, error } = await db.from("guest_passes").insert({
    branch_id: opts.branchId,
    slug: slug8(),
    issuer_name: opts.name,
    issuer_phone: phone || null,
    source: opts.source,
    value_won: PASS_VALUE_WON,
    valid_until: kstDatePlus(PASS_VALID_DAYS),
  }).select("id, slug, valid_until, value_won").maybeSingle();
  if (error) return null;
  return (data as IssuedPass | null) ?? null;
}

/** 회원이 여는 주소 — CRM 앱이 서비스한다 */
export function guestPassUrl(slug: string): string {
  return `https://153-boxing-os.pages.dev/g/${slug}`;
}

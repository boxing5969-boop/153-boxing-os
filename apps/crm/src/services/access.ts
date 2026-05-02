import { supabase } from "@/integrations/supabase/client";
import type { DeniedReason } from "@153/shared";

export type AccessPreviewSource = "grant" | "membership" | "trial";

export type AccessPreview =
  | { allowed: true; member_id: string; member_name: string; source: AccessPreviewSource }
  | { allowed: false; member_id: string | null; reason: DeniedReason; message: string };

export async function getAccessPreview(memberId: string, branchId?: string): Promise<AccessPreview> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "") as string;
  const params = new URLSearchParams({ member_id: memberId });
  if (branchId) params.set("branch_id", branchId);

  const res = await fetch(`${apiBase}/api/access/preview?${params.toString()}`, {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }

  const json = await res.json() as { data: AccessPreview };
  return json.data;
}

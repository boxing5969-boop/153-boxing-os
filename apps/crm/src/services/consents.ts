import { supabase } from "@/integrations/supabase/client";
import type { ConsentRecord, ConsentType } from "@153/shared";

export async function listMemberConsents(memberId: string): Promise<ConsentRecord[]> {
  const { data, error } = await supabase.rpc("list_member_consents", {
    _member_id: memberId,
  });
  if (error) throw error;
  return (data ?? []) as unknown as ConsentRecord[];
}

export interface RevokeConsentResult {
  member_id: string;
  consent_type: ConsentType;
  revoked_count: number;
  sync_jobs_created: number;
  revoked_at: string;
}

export async function revokeMemberConsent(
  memberId: string,
  consentType: ConsentType
): Promise<RevokeConsentResult> {
  const { data, error } = await supabase.rpc("revoke_member_consent", {
    _member_id: memberId,
    _consent_type: consentType,
  });
  if (error) throw error;
  return data as unknown as RevokeConsentResult;
}

export interface RecordConsentResult {
  consent_id: string;
  member_id: string;
  consent_type: ConsentType;
  agreed_at: string;
}

export async function recordMemberConsent(
  memberId: string,
  consentType: ConsentType
): Promise<RecordConsentResult> {
  const { data, error } = await supabase.rpc("record_member_consent", {
    _member_id: memberId,
    _consent_type: consentType,
  });
  if (error) throw error;
  return data as unknown as RecordConsentResult;
}

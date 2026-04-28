import { supabase } from "@/integrations/supabase/client";
import type { EmergencyPin } from "@153/shared";

export interface EmergencyPinRow extends EmergencyPin {
  branch_name?: string | null;
  issuer_name?: string | null;
}

export async function listEmergencyPins(): Promise<EmergencyPinRow[]> {
  const { data, error } = await supabase
    .from("emergency_pins")
    .select("*, branch:branches(name), issuer:profiles!emergency_pins_issued_by_fkey(name)")
    .order("issued_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  type Joined = EmergencyPin & {
    branch?: { name: string } | null;
    issuer?: { name: string } | null;
  };
  return ((data ?? []) as unknown as Joined[]).map(({ branch, issuer, ...p }) => ({
    ...p,
    branch_name: branch?.name ?? null,
    issuer_name: issuer?.name ?? null,
  }));
}

export interface IssueEmergencyPinInput {
  branch_id: string;
  purpose?: string;
  ttl_minutes?: number;
  max_uses?: number;
}

export interface IssueEmergencyPinResult {
  pin_id: string;
  pin: string;
  branch_id: string;
  expires_at: string;
  max_uses: number;
  issued_by: string;
}

export async function issueEmergencyPin(
  input: IssueEmergencyPinInput
): Promise<IssueEmergencyPinResult> {
  const { data, error } = await supabase.rpc("issue_emergency_pin", {
    _branch_id: input.branch_id,
    _purpose: input.purpose ?? null,
    _ttl_minutes: input.ttl_minutes ?? 10,
    _max_uses: input.max_uses ?? 1,
  });
  if (error) throw error;
  return data as unknown as IssueEmergencyPinResult;
}

export async function revokeEmergencyPin(pinId: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_emergency_pin", {
    _pin_id: pinId,
  });
  if (error) throw error;
}

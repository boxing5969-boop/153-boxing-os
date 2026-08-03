import { supabase } from "@/integrations/supabase/client";

/** 회원 확장 프로필 (브로제이 명단의 추가 항목) */
export interface MemberProfile {
  member_id: string;
  new_or_re: string | null;
  locker: string | null;
  rental: string | null;
  cumulative_payment: number | null;
  last_purchase_date: string | null;
  mileage: string | null;
  coupons: string | null;
  broj_runtalk: string | null;
  attendance_no: string | null;
  notes: string | null;
  visit_route: string | null;
  exercise_purpose: string | null;
  address: string | null;
  coach_name: string | null;
  status_orig: string | null;
}

export async function getMemberProfile(memberId: string): Promise<MemberProfile | null> {
  const { data } = await supabase
    .from("member_profiles")
    .select("*")
    .eq("member_id", memberId)
    .maybeSingle();
  return (data as unknown as MemberProfile | null) ?? null;
}

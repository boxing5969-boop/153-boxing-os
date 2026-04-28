import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@153/shared";

export interface UpdateOwnProfileInput {
  name: string;
  phone: string | null;
}

export async function updateOwnProfile(input: UpdateOwnProfileInput): Promise<Profile> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("not authenticated");
  const { data, error } = await supabase
    .from("profiles")
    .update({ name: input.name, phone: input.phone })
    .eq("auth_user_id", userData.user.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Profile;
}

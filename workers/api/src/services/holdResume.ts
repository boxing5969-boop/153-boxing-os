import type { Env } from "../lib/env";
import { getServiceClient } from "../lib/supabase";

/**
 * 홀딩 자동 해제 — hold_end 가 지난 일시정지(paused) 회원권을 active 로 복귀시키고
 * 출입권한을 재활성한다. 일일 크론에서 호출(resume_due_holds RPC).
 */
export async function runResumeDueHolds(env: Env): Promise<{ resumed: number }> {
  const db = getServiceClient(env);
  const { data, error } = await db.rpc("resume_due_holds");
  if (error) throw new Error(`resume_due_holds: ${error.message}`);
  return { resumed: Number(data ?? 0) };
}

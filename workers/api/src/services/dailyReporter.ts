/**
 * 일일 운영 리포트
 * 매일 오전 9시 (KST) 지점 관리자에게 SMS로 발송
 */
import { getServiceClient } from "../lib/supabase";
import { sendSms } from "./smsNotifier";
import type { Env } from "../lib/env";

interface BranchManagerRow {
  id: string;
  name: string;
  phone: string | null;
  branch_id: string | null;
  branches: { name: string } | null;
}

interface DailyStats {
  today_success: number;
  today_denied:  number;
  expiring_7d:   number;
  unpaid_count:  number;
  new_today:     number;
}

export async function runDailyReport(env: Env): Promise<void> {
  const db = getServiceClient(env);

  // 활성 지점의 관리자(관장 + 지점 매니저) 목록 조회
  const { data, error } = await db
    .from("profiles")
    .select("id,name,phone,branch_id,branches(name)")
    .in("role", ["branch_owner", "branch_manager"])
    .eq("status", "active")
    .not("branch_id", "is", null)
    .not("phone", "is", null);

  if (error) {
    console.error("[dailyReport] managers fetch failed:", error);
    return;
  }

  const managers = (data ?? []) as unknown as BranchManagerRow[];
  if (managers.length === 0) {
    console.log("[dailyReport] no managers found");
    return;
  }

  // 지점별로 한 번씩만 발송 (복수 관리자 있어도 첫 번째에게만)
  const sentBranches = new Set<string>();
  const today = new Date().toLocaleDateString("ko-KR", {
    month: "long",
    day:   "numeric",
    weekday: "short",
  });

  for (const mgr of managers) {
    if (!mgr.phone || !mgr.branch_id) continue;
    if (sentBranches.has(mgr.branch_id)) continue;
    sentBranches.add(mgr.branch_id);

    const branchName = mgr.branches?.name ?? "지점";

    // 통계 조회
    const { data: statsRaw, error: statsErr } = await db.rpc(
      "get_daily_report_stats",
      { _branch_id: mgr.branch_id }
    );

    if (statsErr || !statsRaw?.[0]) {
      console.error(`[dailyReport] stats failed for branch ${mgr.branch_id}:`, statsErr);
      continue;
    }

    const s = statsRaw[0] as unknown as DailyStats;

    const lines: string[] = [
      `[${branchName}] ${today} 운영리포트`,
      `출입 성공: ${s.today_success}명`,
      `출입 거절: ${s.today_denied}건`,
      `이번주 만료: ${s.expiring_7d}명`,
    ];
    if (s.unpaid_count > 0) lines.push(`미납 회원: ${s.unpaid_count}명 ⚠️`);
    if (s.new_today  > 0) lines.push(`신규 등록: ${s.new_today}명 🎉`);

    const message = lines.join("\n");

    // SMS 미설정이면 콘솔만
    if (!env.SOLAPI_API_KEY) {
      console.log(`[dailyReport] (SMS 미설정) ${branchName}:`, message);
      continue;
    }

    try {
      const result = await sendSms(db, env, mgr.branch_id, mgr.phone, message);
      if (result.success) {
        console.log(`[dailyReport] sent to ${mgr.name} (${branchName})`);
      } else {
        console.error(`[dailyReport] send failed to ${mgr.name}:`, result.error);
      }
    } catch (err) {
      console.error(`[dailyReport] exception for ${mgr.name}:`, err);
    }
  }

  console.log(`[dailyReport] done — branches: ${sentBranches.size}`);
}

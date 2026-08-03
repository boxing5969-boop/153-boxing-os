// 온보딩·재등록 자동발송 결과 + 전날 회원관리 현황을 매일 대표님께 카카오(실패 시 문자)로 보고한다.
// 매시간 크론에서 호출되며, KST 11시(10시 자동발송 직후)에만 1회 실행한다.
// 발송 경로: sendFriendTalk(카카오 브랜드메시지) → 실패 시 sendSms 폴백. 결과는 ops_message_logs 에 기록.
import type { Env } from "../lib/env";
import { getServiceClient } from "../lib/supabase";
import { sendSms, sendFriendTalk } from "./smsNotifier";
import { buildHealthReport } from "./healthReporter";

// 리포트 수신자(대표). 추후 설정 테이블로 옮길 수 있음. 지금은 상수.
const REPORT_PHONE = "01044144153";
const REPORT_HOUR_KST = 11;

function kstDateStr(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000)
    .toISOString()
    .slice(0, 10);
}
function kstHour(): number {
  return new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
}
function dtDays(dateStr: string | null, now: number): number | null {
  if (!dateStr) return null;
  const t = Date.parse(`${dateStr.slice(0, 10).replace(/\./g, "-")}T00:00:00+09:00`);
  return Number.isNaN(t) ? null : Math.floor((t - now) / 86400000);
}

interface DispatchRow {
  member_name: string | null;
  kind: string;
  step: number | null;
  status: string;
  error: string | null;
}
interface SnapRow {
  start_date: string | null;
  end_date: string | null;
  latest_visit_date: string | null;
  status: string | null;
}

export async function runDailyAutomationReport(env: Env): Promise<void> {
  if (kstHour() !== REPORT_HOUR_KST) return; // 11시에만 1회
  const db = getServiceClient(env);
  const today = kstDateStr(0);
  const yday = kstDateStr(-1);

  // 자동화 켜진(리포트 대상) 지점
  const { data: cfgs } = await db
    .from("fc_automation_config")
    .select("branch_id, onboarding_enabled, renewal_enabled")
    .or("onboarding_enabled.eq.true,renewal_enabled.eq.true");
  const branchIds = (cfgs ?? []).map((c: { branch_id: string }) => c.branch_id);
  if (branchIds.length === 0) return;

  // 오늘 자동발송 결과
  const { data: disp } = await db
    .from("automation_dispatch_log")
    .select("member_name, kind, step, status, error")
    .eq("dispatched_on", today)
    .in("branch_id", branchIds);
  const rows = (disp ?? []) as DispatchRow[];
  const onbSent = rows.filter((r) => r.kind === "onboarding" && r.status === "sent").length;
  const onbFail = rows.filter((r) => r.kind === "onboarding" && r.status === "failed");
  const reSent = rows.filter((r) => r.kind === "renewal" && r.status === "sent").length;
  const reFail = rows.filter((r) => r.kind === "renewal" && r.status === "failed");

  // 어제 회원관리 활동(코치 문자·연락 등)
  const { data: ops } = await db
    .from("ops_message_logs")
    .select("id")
    .in("branch_id", branchIds)
    .gte("created_at", `${yday}T00:00:00+09:00`)
    .lt("created_at", `${today}T00:00:00+09:00`);
  const careCount = (ops ?? []).length;

  // 회원 현황(만료임박·미방문·신규)
  // PostgREST 는 1000행에서 자른다 — 자동화 지점이 2곳만 돼도 대표 리포트 숫자가 조용히 준다.
  const snaps: { start_date: string | null; end_date: string | null; latest_visit_date: string | null; status: string | null }[] = [];
  for (let off = 0; off < 20000; off += 1000) {
    const { data: page } = await db
      .from("member_snapshots")
      .select("start_date, end_date, latest_visit_date, status")
      .in("branch_id", branchIds)
      .order("id", { ascending: true })
      .range(off, off + 999);
    const arr = (page as typeof snaps | null) ?? [];
    snaps.push(...arr);
    if (arr.length < 1000) break;
  }
  const now = Date.now();
  let expiring = 0,
    noVisit = 0,
    newM = 0;
  for (const m of snaps as SnapRow[]) {
    const st = m.status ?? "";
    if (st.includes("만료") || st.includes("탈퇴") || st.includes("환불")) continue;
    const dEnd = dtDays(m.end_date, now);
    const dv = dtDays(m.latest_visit_date, now);
    const nv = dv == null ? null : -dv;
    const ds = dtDays(m.start_date, now);
    const el = ds == null ? null : -ds;
    const dormant = (dEnd != null && dEnd < 0) || (nv != null && nv >= 30);
    if (!dormant && dEnd != null && dEnd >= 0 && dEnd <= 7) expiring++;
    else if (!dormant && (dEnd == null || dEnd > 7) && nv != null && nv >= 7) noVisit++;
    if (el != null && el >= 0 && el <= 30) newM++;
  }

  // 본문 (카카오 길이 여유 있게 간결)
  const lines: string[] = [];
  lines.push(`[153 자동관리 리포트] ${today}`);
  lines.push("");
  lines.push(`오늘 자동발송(10시)`);
  lines.push(`- 온보딩 성공 ${onbSent} / 실패 ${onbFail.length}`);
  for (const f of onbFail.slice(0, 5)) {
    lines.push(`  · ${f.member_name ?? "회원"}(D+${f.step ?? "?"}) ${(f.error ?? "").slice(0, 24)}`);
  }
  if (reSent || reFail.length) {
    lines.push(`- 재등록 성공 ${reSent} / 실패 ${reFail.length}`);
  }
  lines.push("");
  lines.push(`어제(${yday}) 회원관리`);
  lines.push(`- 문자·연락 ${careCount}건`);
  lines.push("");
  lines.push(`회원 현황`);
  lines.push(`- 만료임박(7일) ${expiring}명`);
  lines.push(`- 미방문(7일+) ${noVisit}명`);
  lines.push(`- 신규(30일) ${newM}명`);

  // 시스템 점검(반별 출석·코치진 활동·자동화 현황·이상 감시)을 같은 리포트에 이어붙인다.
  // ⚠️ 대표님은 카톡 한 통으로 다 보길 원하신다 — 리포트를 쪼개지 않는다.
  //    조사 실패가 자동관리 리포트 자체를 막지 않도록 try 로 감싼다.
  try {
    const health = await buildHealthReport(db);
    lines.push("");
    lines.push("─────────────");
    lines.push(health.text);
  } catch (e) {
    console.error("[dailyAutomationReport] health", e);
    lines.push("", "(시스템 점검 항목은 이번 회차에 조회하지 못했습니다)");
  }

  const body = lines.join("\n");

  // 발송: 카카오 우선 → 실패 시 문자
  const senderBranch = branchIds[0];
  if (!senderBranch) return; // 위 length===0 가드로 도달 불가(타입 좁히기)
  let res = await sendFriendTalk(db, env, senderBranch, REPORT_PHONE, body, { isAd: false });
  if (!res.success) {
    res = await sendSms(db, env, senderBranch, REPORT_PHONE, body);
  }
  try {
    await db.from("ops_message_logs").insert({
      branch_id: senderBranch,
      recipient_name: "대표(자동리포트)",
      phone: REPORT_PHONE,
      template_type: "daily_auto_report",
      content: body,
      status: res.success ? "sent" : "failed",
    });
  } catch {
    /* 로그 실패 무시 */
  }
}

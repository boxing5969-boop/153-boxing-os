/**
 * 시스템 이상 감시 일일 리포트 (본사 마스터 전용)
 *
 * 매일 아침 자동으로 "어제 우리 시스템에 문제가 있었나"를 한 장으로 보고한다.
 * 사장님이 앱을 열어보지 않아도 사고를 놓치지 않게 하는 것이 목적 — 그래서
 * ① 이상이 있으면 무엇이·누구에게·몇 건인지 숫자로 ② 없으면 "정상"이라고 분명히 말한다.
 *
 * 감시 항목 (전부 지난 24시간 기준)
 *   1. 중복 발송 — 같은 사람(전화번호)에게 같은 안내가 두 번 이상. **회원 id 가 아니라 번호로 판정**
 *      (명부 동기화로 id 가 바뀌어도 사고를 잡아내기 위함 — 감시가 감시 대상과 같은 약점을 갖지 않게)
 *   2. 발송 실패 — 자동발송/인앱발송 실패 건수와 대표 사유
 *   3. 멈춘 발송 — 선점만 되고 결과가 안 찍힌 건(크론 중도 사망 신호)
 *   4. 데이터 동기화 — 브로제이 실패, 회원 명부 갱신 여부
 *   5. 자동화 상태 — 켜져 있는데 대상이 0인 지점(조건 오류 신호)
 */
import { getServiceClient } from "../lib/supabase";
import { sendSms } from "./smsNotifier";
import type { Env } from "../lib/env";
import type { SupabaseClient } from "@supabase/supabase-js";

function kstDate(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}
function addDaysStr(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
const KIND_KO: Record<string, string> = {
  onboarding: "신규 온보딩", renewal: "재등록 안내", pace_drop: "페이스 하락 안부", weekly_care: "주간 안부",
};
/**
 * 반(班) 구분 — 실측 출입 분포(최근 30일)로 정한 경계.
 * 6~9시 아침(7시 피크) · 10~14시 낮(11·12시 피크) · 15~17시 오후 · 18~23시 저녁(20시 피크).
 * 시간대를 바꾸려면 여기만 고치면 리포트 전체가 따라온다.
 */
const SHIFTS: { key: string; ko: string; from: number; to: number }[] = [
  { key: "morning", ko: "오전반", from: 6, to: 9 },
  { key: "lunch", ko: "점심반", from: 10, to: 14 },
  { key: "afternoon", ko: "오후반", from: 15, to: 17 },
  { key: "evening", ko: "저녁반", from: 18, to: 23 },
];
const shiftOf = (hour: number): string | null => SHIFTS.find((s) => hour >= s.from && hour <= s.to)?.key ?? null;
const ROLE_KO: Record<string, string> = {
  super_admin: "본사", hq_admin: "본사", branch_owner: "관장", branch_manager: "지점장", coach: "코치",
};
const maskPhone = (p: string | null): string => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length < 7 ? "번호없음" : `${d.slice(0, 3)}-****-${d.slice(-4)}`;
};

interface DispatchRow {
  branch_id: string; member_name: string | null; phone: string | null;
  kind: string; step: number | null; status: string | null; error: string | null; dispatched_on: string | null;
}

export interface HealthReport { checked: string; issues: number; text: string }

/**
 * 지난 24시간 시스템 상태를 조사해 보고문을 만든다(발송은 별도).
 *
 * @param focusBranchId 지정하면 **그 지점만** 본다. 대표님이 "선릉 위주로, 잠실·역삼은 빼줘"라고 하셔서
 *   지점 전부를 훑던 걸 한 곳으로 좁힐 수 있게 했다. 안 넘기면 예전처럼 전 지점(본사 관제용).
 */
export async function buildHealthReport(db: SupabaseClient, focusBranchId?: string | null): Promise<HealthReport> {
  /** 지점 범위 좁히기 — branch_id 를 가진 조회에만 붙인다 */
  // T 를 자기 제약 안에서 다시 쓰면(<T extends { eq: (...) => T }>) Supabase 의 원래도 깊은
  // 쿼리 타입과 맞물려 컴파일러가 무한히 파고든다(TS2589). 제약을 걷고 호출 지점에서만 좁힌다.
  const sc = <T>(q: T): T =>
    focusBranchId
      ? (q as unknown as { eq: (col: string, val: string) => T }).eq("branch_id", focusBranchId)
      : q;
  const today = kstDate(0);
  const since = kstDate(-1);          // 자동발송·직원활동 = 어제(당일 확정 데이터)
  const since7 = kstDate(-7);
  /**
   * 출석 기준일 = 어제.
   * 2026-08-01 이전에는 출석 동기화가 하루 1회 + 지점 로테이션이라 지점당 3일에 한 번만 갱신됐고
   * (선릉·역삼의 7/31 저녁이 통째로 비었다), 그래서 한때 기준일을 그저께로 미뤘다.
   * 지금은 runBrojAttendanceSync 가 **매시간 전 지점** 출석을 채우므로 어제 데이터가 자정에 이미 완전하다.
   * 대신 아래에서 '지점별 마지막 출입 시각'을 검사해 동기화가 멈춘 지점을 직접 경고한다.
   */
  const attDay = since;

  // 출석 집계 창 = attDay 하루 (KST 자정~자정)
  const ydayFromIso = `${attDay}T00:00:00+09:00`;
  const ydayToIso = `${addDaysStr(attDay, 1)}T00:00:00+09:00`;

  const [branchesR, dispatchR, msgR, syncR, autoR, attR, rewardR, profR, classR, subR, trendR] = await Promise.all([
    focusBranchId
      ? db.from("branches").select("id, name").eq("id", focusBranchId)
      : db.from("branches").select("id, name"),
    sc(db.from("automation_dispatch_log")
      .select("branch_id, member_name, phone, kind, step, status, error, dispatched_on")
      .gte("dispatched_on", since)).limit(3000),
    sc(db.from("ops_message_logs").select("branch_id, status, created_at, created_by").gte("created_at", `${since}T00:00:00Z`)).limit(3000),
    sc(db.from("broj_sync_runs").select("branch_id, kind, status, error_message, finished_at").gte("finished_at", `${since}T00:00:00Z`)).limit(200),
    sc(db.from("fc_automation_config").select("branch_id, onboarding_enabled, renewal_enabled, pace_drop_enabled, weekly_care_enabled")),
    // 어제 출입 — 반별 집계용
    sc(db.from("attendance_logs").select("branch_id, phone, attended_at")
      .eq("counts_as_visit", true)   // 직원 출근·거절된 출입 제외 — 리포트 숫자는 '회원 방문'이다
      .gte("attended_at", ydayFromIso).lt("attended_at", ydayToIso))
      .order("attended_at", { ascending: false }).limit(5000),   // 캡에 걸려도 최신 우선
    // 어제 직원 활동 — 미션 XP
    sc(db.from("reward_events").select("user_id, branch_id, xp_bonus, event_date")
      .eq("event_date", since).not("user_id", "is", null)).limit(2000),
    sc(db.from("profiles").select("id, name, role, branch_id").in("role", ["branch_owner", "branch_manager", "coach"]).eq("status", "active")),
    sc(db.from("class_logs").select("branch_id, class_date, shift, coach_name, attendance_count, mood").eq("class_date", since)),
    sc(db.from("branch_subscriptions").select("branch_id, status")),
    // 최근 7일 출석 추세 — 하루 숫자만 보면 동기화 지연·휴관을 사고로 오해한다
    sc(db.from("attendance_logs").select("attended_at, branch_id")
      .eq("counts_as_visit", true)
      .gte("attended_at", `${addDaysStr(since, -6)}T00:00:00+09:00`)
      .lt("attended_at", `${addDaysStr(since, 1)}T00:00:00+09:00`))
      .order("attended_at", { ascending: false }).limit(8000),
  ]);

  const brName = new Map(((branchesR.data as { id: string; name: string }[] | null) ?? []).map((b) => [b.id, b.name]));
  const disp = (dispatchR.data as DispatchRow[] | null) ?? [];
  const lines: string[] = [];
  let issues = 0;

  // ── 1) 중복 발송 (번호 기준) ──
  const dupKey = new Map<string, { name: string | null; phone: string; kind: string; branch: string; days: string[] }>();
  for (const r of disp) {
    if ((r.status ?? "") === "failed") continue;
    const d = (r.phone ?? "").replace(/\D/g, "");
    if (!d) continue;
    const k = `${d}|${r.kind}|${r.step ?? -1}`;
    const e = dupKey.get(k);
    const day = r.dispatched_on ?? today;
    if (e) e.days.push(day);
    else dupKey.set(k, { name: r.member_name, phone: d, kind: r.kind, branch: brName.get(r.branch_id) ?? "지점", days: [day] });
  }
  const dups = [...dupKey.values()].filter((v) => v.days.length > 1);
  if (dups.length > 0) {
    issues += dups.length;
    lines.push(`■ 중복 발송 ${dups.length}건 ⚠️`);
    for (const d of dups.slice(0, 5)) {
      lines.push(`· ${d.branch} ${d.name ?? "회원"}(${maskPhone(d.phone)}) — ${KIND_KO[d.kind] ?? d.kind} ${d.days.length}회`);
    }
    if (dups.length > 5) lines.push(`· 외 ${dups.length - 5}건`);
    lines.push(`→ 앱 > 데이터 센터 > 자동발송 리포트에서 확인. 회원 사과 문자 필요 여부 판단 바랍니다.`);
  }

  // ── 2) 발송 실패 ──
  const failed = disp.filter((r) => r.status === "failed");
  const inappFail = ((msgR.data as { status: string | null }[] | null) ?? []).filter((m) => m.status === "failed").length;
  if (failed.length > 0 || inappFail > 0) {
    issues += failed.length + inappFail;
    lines.push(`■ 발송 실패 ${failed.length + inappFail}건`);
    const byErr = new Map<string, number>();
    for (const f of failed) byErr.set((f.error ?? "사유 미상").slice(0, 40), (byErr.get((f.error ?? "사유 미상").slice(0, 40)) ?? 0) + 1);
    for (const [msg, n] of [...byErr.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) lines.push(`· ${msg} — ${n}건`);
    if (inappFail > 0) lines.push(`· 직원 인앱 발송 실패 ${inappFail}건`);
  }

  // ── 3) 멈춘 발송(선점 후 미완료) ──
  const stuck = disp.filter((r) => (r.status ?? "pending") === "pending" && (r.dispatched_on ?? today) < today);
  if (stuck.length > 0) {
    issues += stuck.length;
    lines.push(`■ 멈춘 발송 ${stuck.length}건 — 예약만 되고 결과가 없습니다(중간에 끊긴 신호). 오늘 자동으로 재확인됩니다.`);
  }

  // ── 4) 데이터 동기화 ──
  const syncs = (syncR.data as { branch_id: string; kind: string; status: string; error_message: string | null }[] | null) ?? [];
  const syncFail = syncs.filter((s) => s.status !== "success");
  if (syncFail.length > 0) {
    issues += syncFail.length;
    lines.push(`■ 브로제이 동기화 실패 ${syncFail.length}건`);
    for (const s of syncFail.slice(0, 3)) lines.push(`· ${brName.get(s.branch_id) ?? "지점"} ${s.kind} — ${(s.error_message ?? "사유 미상").slice(0, 40)}`);
  }

  // ── 5) 켜져 있는데 대상 0 (조건 오류 신호) ──
  const autos = (autoR.data as { branch_id: string; onboarding_enabled: boolean | null; renewal_enabled: boolean | null; pace_drop_enabled: boolean | null; weekly_care_enabled: boolean | null }[] | null) ?? [];
  const sentBranchKinds = new Set(disp.filter((r) => r.status !== "failed").map((r) => `${r.branch_id}|${r.kind}`));
  const idleWarn: string[] = [];
  for (const a of autos) {
    const on: [boolean, string][] = [
      [!!a.onboarding_enabled, "onboarding"], [!!a.renewal_enabled, "renewal"],
      [!!a.pace_drop_enabled, "pace_drop"], [!!a.weekly_care_enabled, "weekly_care"],
    ];
    for (const [enabled, kind] of on) {
      if (enabled && !sentBranchKinds.has(`${a.branch_id}|${kind}`)) {
        idleWarn.push(`${brName.get(a.branch_id) ?? "지점"} ${KIND_KO[kind] ?? kind}`);
      }
    }
  }

  // ── 발송량 요약(정상 지표) ──
  const okCount = disp.filter((r) => r.status !== "failed" && r.status !== "pending").length;
  const byKind = new Map<string, number>();
  for (const r of disp) if (r.status !== "failed") byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);

  // ══ A. 반별 출석 (어제) — 지점 × 시간대 ══
  type ShiftAgg = { visits: number; people: Set<string> };
  const shiftByBranch = new Map<string, Map<string, ShiftAgg>>();
  const shiftTotal = new Map<string, ShiftAgg>();
  for (const a of (attR.data as { branch_id: string; phone: string | null; attended_at: string }[] | null) ?? []) {
    const h = new Date(new Date(a.attended_at).getTime() + 9 * 3600 * 1000).getUTCHours();
    const sk = shiftOf(h);
    if (!sk) continue;
    const who = (a.phone ?? "").replace(/\D/g, "") || `x${a.attended_at}`;
    const bm = shiftByBranch.get(a.branch_id) ?? new Map<string, ShiftAgg>();
    const e = bm.get(sk) ?? { visits: 0, people: new Set<string>() };
    e.visits++; e.people.add(who); bm.set(sk, e); shiftByBranch.set(a.branch_id, bm);
    const t = shiftTotal.get(sk) ?? { visits: 0, people: new Set<string>() };
    t.visits++; t.people.add(who); shiftTotal.set(sk, t);
  }
  const attendLines: string[] = [];
  {
    const totalVisits = [...shiftTotal.values()].reduce((s, v) => s + v.visits, 0);
    // 날짜를 밝힌다 — "어제"라고만 쓰면 하루 늦은 집계를 오해한다
    attendLines.push(`■ 어제(${attDay.slice(5).replace("-", "/")}) 출석 ${totalVisits}회`);
    for (const s of SHIFTS) {
      const t = shiftTotal.get(s.key);
      if (!t) continue;
      const share = totalVisits > 0 ? Math.round((t.visits / totalVisits) * 100) : 0;
      attendLines.push(`· ${s.ko}(${s.from}~${s.to}시) ${t.visits}회 · ${t.people.size}명 · ${share}%`);
    }
    // 지점별 한 줄 (반별 인원)
    for (const [bid, bm] of shiftByBranch) {
      const parts = SHIFTS.filter((s) => bm.get(s.key)).map((s) => `${s.ko} ${bm.get(s.key)!.people.size}`);
      if (parts.length) attendLines.push(`· ${brName.get(bid) ?? "지점"} — ${parts.join(" / ")}`);
    }
    if (totalVisits === 0) attendLines.push(`· 출입 기록 없음 (키오스크 미연동 지점만 운영했거나 휴관)`);

    // 지점별 '마지막 출입 시각' 검사 — 동기화가 멈춘 지점을 직접 잡는다.
    // (2026-08-01: 선릉·역삼이 3일째 갱신 안 된 걸 사람이 눈으로 발견했다. 다시는 사람이 찾게 두지 않는다)
    {
      const lastByBranch = new Map<string, string>();
      for (const t of (trendR.data as { attended_at: string; branch_id?: string }[] | null) ?? []) {
        const bid = (t as { branch_id?: string }).branch_id ?? "";
        if (!bid) continue;
        const cur = lastByBranch.get(bid);
        if (!cur || t.attended_at > cur) lastByBranch.set(bid, t.attended_at);
      }
      const staleBranches: string[] = [];
      for (const [bid, name] of brName) {
        const last = lastByBranch.get(bid);
        if (!last) continue;                       // 기록 자체가 없는 지점(키오스크 미연동)은 제외
        const hoursAgo = Math.round((Date.now() - Date.parse(last)) / 3600000);
        if (hoursAgo >= 30) staleBranches.push(`${name.replace("153복싱짐 ", "")} ${Math.floor(hoursAgo / 24)}일 ${hoursAgo % 24}시간째`);
      }
      if (staleBranches.length > 0) {
        issues += staleBranches.length;
        attendLines.push(`  ⚠️ 출석 동기화 멈춤 — ${staleBranches.join(" · ")} (브로제이 연동 확인 필요)`);
      }
    }

    // 최근 7일 추세 — 하루 숫자만 보면 휴관·동기화 지연을 사고로 오해한다
    const byDayCnt = new Map<string, number>();
    for (const t of (trendR.data as { attended_at: string }[] | null) ?? []) {
      const day = new Date(new Date(t.attended_at).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      byDayCnt.set(day, (byDayCnt.get(day) ?? 0) + 1);
    }
    const trendDays = [...byDayCnt.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (trendDays.length > 1) {
      const isWeekend = (d: string) => { const g = new Date(`${d}T00:00:00Z`).getUTCDay(); return g === 0 || g === 6; };
      attendLines.push(
        `· 7일 추세 ${trendDays.map(([dd, n]) => `${dd.slice(8)}일${isWeekend(dd) ? "*" : ""} ${n}`).join(" · ")}`,
      );

      // ⚠️ 주말은 평일의 1/4 수준이 정상이다(토·일 20~28회 vs 평일 100회 안팎).
      //    평일 평균과 비교하면 매주 토·일마다 "절반 이하" 경보가 뜬다 — 그러면 진짜 사고를 놓친다.
      //    같은 성격의 날(주말↔주말, 평일↔평일)끼리만 비교한다.
      const yWeekend = isWeekend(since);
      // ⚠️ slice(0,-1)은 '마지막=어제' 가정 — 어제가 0회면 어제 행이 아예 없어 엉뚱한 날이 잘린다.
      //    (일요일 키오스크 전면 사망 시 비교군인 토요일이 잘려 경보가 침묵하는 걸 실행 검증으로 재현)
      const peers = trendDays.filter(([d]) => d !== since && isWeekend(d) === yWeekend).map(([, n]) => n);
      if (peers.length >= 1) {
        const avg = Math.round(peers.reduce((s, n) => s + n, 0) / peers.length);
        if (avg > 0 && totalVisits < avg * 0.5) {
          issues += 1;
          attendLines.push(
            `  ⚠️ 같은 ${yWeekend ? "주말" : "평일"} 평소(약 ${avg}회)의 절반 이하 — 휴관일이 아니라면 키오스크·동기화를 확인해 주세요.`,
          );
        }
      }
      if (trendDays.some(([d]) => isWeekend(d))) attendLines.push(`  (* = 주말. 주말은 평일보다 원래 적습니다)`);
    }
  }

  // ══ B. 코치진 활동 (어제) ══
  const profs = (profR.data as { id: string; name: string | null; role: string; branch_id: string | null }[] | null) ?? [];
  const profMap = new Map(profs.map((p) => [p.id, p]));
  const xpByUser = new Map<string, number>();
  const actByUser = new Map<string, number>();
  for (const r of (rewardR.data as { user_id: string; xp_bonus: number | null }[] | null) ?? []) {
    xpByUser.set(r.user_id, (xpByUser.get(r.user_id) ?? 0) + Number(r.xp_bonus ?? 0));
    actByUser.set(r.user_id, (actByUser.get(r.user_id) ?? 0) + 1);
  }
  const msgByUser = new Map<string, number>();
  for (const m of (msgR.data as { created_by: string | null }[] | null) ?? []) {
    if (m.created_by) msgByUser.set(m.created_by, (msgByUser.get(m.created_by) ?? 0) + 1);
  }
  const staffLines: string[] = [];
  {
    const rows = profs
      .map((p) => ({ p, xp: xpByUser.get(p.id) ?? 0, act: actByUser.get(p.id) ?? 0, msg: msgByUser.get(p.id) ?? 0 }))
      .filter((r) => r.xp > 0 || r.act > 0 || r.msg > 0)
      .sort((a, b) => b.xp - a.xp);
    const idle = profs.length - rows.length;
    staffLines.push(`■ 코치진 활동 — 활동 ${rows.length}명 / 전체 ${profs.length}명`);
    for (const r of rows.slice(0, 8)) {
      const br = r.p.branch_id ? (brName.get(r.p.branch_id) ?? "") : "";
      staffLines.push(`· ${r.p.name ?? "직원"}(${ROLE_KO[r.p.role] ?? r.p.role}${br ? `·${br.replace("153복싱짐 ", "")}` : ""}) ${r.xp}점 · 미션 ${r.act}건${r.msg ? ` · 문자 ${r.msg}건` : ""}`);
    }
    if (rows.length === 0) staffLines.push(`· 어제 앱에서 활동한 직원이 없습니다 (휴무일이면 정상)`);
    else if (idle > 0) staffLines.push(`· 미활동 ${idle}명 — 앱 사용 독려가 필요할 수 있습니다`);
    // 수업 일지
    const cls = (classR.data as { branch_id: string; shift: string; coach_name: string | null; attendance_count: number | null; mood: string | null }[] | null) ?? [];
    if (cls.length > 0) {
      for (const c of cls.slice(0, 4)) {
        const sko = SHIFTS.find((s) => s.key === c.shift)?.ko ?? c.shift;
        staffLines.push(`· 수업일지 ${brName.get(c.branch_id)?.replace("153복싱짐 ", "") ?? ""} ${sko} — ${c.attendance_count ?? "?"}명${c.mood ? ` · ${c.mood}` : ""}${c.coach_name ? ` (${c.coach_name})` : ""}`);
      }
    }
  }

  // ══ C. 앱 자동화 현황 ══
  const subs = (subR.data as { branch_id: string; status: string }[] | null) ?? [];
  const activeSubs = subs.filter((s) => s.status === "active").length;
  const autoOnCount = autos.filter((a) => a.onboarding_enabled || a.renewal_enabled || a.pace_drop_enabled || a.weekly_care_enabled).length;
  const syncOk = syncs.filter((s) => s.status === "success").length;
  const autoLines = [
    `■ 앱 자동화 현황`,
    `· 자동발송 켠 지점 ${autoOnCount}곳 · 유료 구독 ${activeSubs}곳`,
    `· 어제 자동 발송 ${okCount}건${failed.length ? ` (실패 ${failed.length})` : ""}`,
    ...[...byKind.entries()].map(([k, n]) => `  - ${KIND_KO[k] ?? k} ${n}건`),
    `· 데이터 동기화 ${syncOk}건 성공${syncFail.length ? ` · 실패 ${syncFail.length}` : ""}`,
    `· 직원 인앱 문자 ${((msgR.data as unknown[] | null) ?? []).length}건`,
  ];

  const scopeKo = focusBranchId
    ? `${([...brName.values()][0] ?? "지점").replace("153복싱짐 ", "")} 기준`
    : "전 지점";
  const head = issues === 0
    ? `[시스템 점검 · ${scopeKo}] ${today}\n✅ 이상 없음 — 어제 사고 0건`
    : `[시스템 점검 · ${scopeKo}] ${today}\n⚠️ 확인 필요 ${issues}건`;

  const body = [
    ``,
    ...attendLines,          // A. 반별 출석
    ``,
    ...staffLines,           // B. 코치진 활동
    ``,
    ...autoLines,            // C. 앱 자동화 현황
    ...(lines.length ? [``, `■ 이상 항목`, ...lines] : []),
    ...(idleWarn.length ? [``, `■ 참고 — 켜져 있는데 어제 대상 0`, ...idleWarn.slice(0, 4).map((s) => `· ${s}`), `(조건에 맞는 회원이 없었다는 뜻일 수 있습니다)`] : []),
    ``,
    `자세한 내용은 앱 > 데이터 센터`,
  ].join("\n");

  // 7일 추세 한 줄(있으면)
  let trend = "";
  {
    const { count } = await db.from("automation_dispatch_log")
      .select("id", { count: "exact", head: true }).gte("dispatched_on", since7);
    if (count != null) trend = `\n최근 7일 누적 발송 ${count}건`;
  }

  return { checked: today, issues, text: `${head}${body}${trend}` };
}

/** 마스터(본사)에게 일일 점검 리포트 발송 */
export async function runHealthReport(env: Env): Promise<{ sent: number; issues: number }> {
  const db = getServiceClient(env);
  const report = await buildHealthReport(db);

  // 수신자 = 본사 마스터(super_admin/hq_admin) 중 번호가 있는 사람
  const { data } = await db.from("profiles")
    .select("id, phone, branch_id")
    .in("role", ["super_admin", "hq_admin"])
    .eq("status", "active")
    .not("phone", "is", null);
  const admins = (data as { id: string; phone: string | null; branch_id: string | null }[] | null) ?? [];
  if (admins.length === 0) { console.log("[healthReport] no master phone"); return { sent: 0, issues: report.issues }; }

  // 발신 지점 설정이 필요하므로 지점이 지정된 계정 우선, 없으면 첫 지점 사용
  const { data: br } = await db.from("branches").select("id").limit(1).maybeSingle();
  const fallbackBranch = (br as { id: string } | null)?.id ?? null;

  let sent = 0;
  const seen = new Set<string>();
  for (const a of admins) {
    const digits = (a.phone ?? "").replace(/\D/g, "");
    if (!digits || seen.has(digits)) continue;
    seen.add(digits);
    const branchId = a.branch_id ?? fallbackBranch;
    if (!branchId) continue;
    try {
      const r = await sendSms(db, env, branchId, digits, report.text);
      if (r?.success) sent += 1;
    } catch (e) { console.error("[healthReport] send failed", e); }
  }
  console.log("[healthReport]", { issues: report.issues, sent });
  return { sent, issues: report.issues };
}

// ============================================================
// 오토운영 엔진 (순수 함수 — DB 접근 없음)
// 입력 데이터 → 오늘의 태스크/알림 초안 + 운영 점수.
// 모든 자동 항목은 generated_key 로 멱등(중복 생성 방지).
// 금액은 정수(원), 날짜는 KST yyyy-mm-dd 문자열 기준.
// ============================================================

// 회원관리 액션 표준(프론트 PLAYBOOK 과 동일): action no 1/2/3, open 11~14, close 21~24
export const ACTION_TARGETS: Record<number, { label: string; target: number; cat: TaskCategory }> = {
  1: { label: "만료·재등록 직접 팔로업", target: 2, cat: "followup" },
  2: { label: "미방문·안부 회원 연락", target: 3, cat: "member_care" },
  3: { label: "신규 정착·기타 케어", target: 3, cat: "member_care" },
};
const OPEN_NOS = [11, 12, 13, 14];
const CLOSE_NOS = [21, 22, 23, 24];

export type TaskCategory =
  | "open" | "close" | "sales" | "followup" | "member_care" | "lead"
  | "refund" | "facility" | "report" | "pt" | "inventory" | "admin";
export type Priority = "low" | "normal" | "high" | "urgent";
export type Severity = "info" | "warning" | "danger" | "critical";

export interface ChecklistItemIn { no: number; done: boolean; actual: number }
export interface ReportIn {
  revenue_pt: number; revenue_membership: number; revenue_goods: number; revenue_dan: number;
  refund_amount: number; new_signups: number; re_signups: number; inquiry_count: number;
  morning_attendance: number; lunch_attendance: number; evening_attendance: number;
}
export interface FollowupIn { id: string; member_name: string; status: string; expire_date: string | null }
export interface PtIn { id: string; member_name: string; total_sessions: number; used_sessions: number; no_shows: number; status: string }
export interface RefundIn { id: string; member_name: string; refund_status: string; risk_level: string | null; refund_requested_date: string | null }
export interface LeadIn { id: string; lead_name: string; status: string; first_contact_at: string | null; trial_at: string | null; next_action_at: string | null }
export interface SnapshotIn { id: string; member_name: string; phone: string | null; end_date: string | null; latest_visit_date: string | null; start_date: string | null; status: string | null }
export interface IssueIn { id: string; title: string; severity: string; status: string; due_at: string | null; created_at: string }

export interface OpsInput {
  branchId: string;
  date: string;              // KST 오늘
  nowIso: string;            // 현재 시각 ISO
  afterCloseCutoff: boolean;  // KST 마감 시간(22시) 이후 여부
  report: ReportIn | null;
  checklist: ChecklistItemIn[];
  followups: FollowupIn[];
  ptPasses: PtIn[];
  refunds: RefundIn[];
  leads: LeadIn[];
  snapshots: SnapshotIn[];
  issues: IssueIn[];
  monthlyTarget: number;
  monthNetCumulative: number;
  monthProgressRatio: number; // 0~1 (월 경과율)
}

export interface TaskDraft {
  generated_key: string; category: TaskCategory; priority: Priority;
  title: string; description?: string; action_label?: string;
  source_type?: string; source_id?: string | null;
  member_name?: string; member_phone?: string; due_at?: string | null;
  metadata?: Record<string, unknown>;
}
export interface AlertDraft {
  generated_key: string; severity: Severity; category: string;
  title: string; message: string; source_type?: string; source_id?: string | null; score_impact?: number;
}
export interface ScoreResult {
  total: number; report: number; sales: number; task: number; followup: number;
  lead: number; checklist: number; refund: number; facility: number;
  grade: "safe" | "watch" | "danger"; summary: string; details: Record<string, unknown>;
}

// ── 날짜 유틸 (KST) ──
export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}
function daysSince(dateStr: string | null, today: string): number | null {
  if (!dateStr) return null;
  return dayDiff(today, dateStr.slice(0, 10));
}

// ── 태스크 생성 ──
export function generateTasks(i: OpsInput): TaskDraft[] {
  const t: TaskDraft[] = [];
  const met = (no: number): boolean => {
    const it = i.checklist.find((x) => x.no === no);
    if (!it) return false;
    const tgt = ACTION_TARGETS[no];
    return tgt ? it.actual >= tgt.target : it.done;
  };
  const actualOf = (no: number): number => i.checklist.find((x) => x.no === no)?.actual ?? 0;

  // A. 리포트 미작성
  if (!i.report) {
    t.push({ generated_key: "report_missing", category: "report", priority: i.afterCloseCutoff ? "urgent" : "high",
      title: "일일 리포트 작성 필요", description: "오늘 일일 경영 리포트가 아직 작성되지 않았습니다.", action_label: "리포트 작성", source_type: "daily_report" });
  }

  // B. 오픈/마감 체크
  if (OPEN_NOS.some((n) => !met(n)))
    t.push({ generated_key: "open_check", category: "open", priority: "normal", title: "오픈 점검 미완료", description: "오픈 점검 항목을 완료하세요.", action_label: "점검", source_type: "checklist" });
  if (CLOSE_NOS.some((n) => !met(n)))
    t.push({ generated_key: "close_check", category: "close", priority: i.afterCloseCutoff ? "high" : "normal", title: "마감 점검 미완료", description: "마감 점검 항목을 완료하세요.", action_label: "점검", source_type: "checklist" });

  // C. 회원관리 액션 목표 미달
  for (const noStr of Object.keys(ACTION_TARGETS)) {
    const no = Number(noStr);
    const def = ACTION_TARGETS[no];
    if (!def) continue;
    const cur = actualOf(no);
    if (cur < def.target)
      t.push({ generated_key: `action_${no}`, category: def.cat, priority: no === 1 ? "high" : "normal",
        title: `${def.label}`, description: "회원을 처리할 때마다 +1 — 목표를 채우면 자동 완료됩니다.", action_label: "처리", source_type: "checklist",
        metadata: { target: def.target, actual: cur, action_no: no } });
  }

  // D. 만료 팔로업 (member_followups 진행중)
  for (const f of i.followups) {
    if (f.status !== "진행중") continue;
    t.push({ generated_key: `followup_${f.id}`, category: "followup", priority: "high",
      title: `만료 팔로업: ${f.member_name}`, description: f.expire_date ? `만료일 ${f.expire_date}` : "진행중 팔로업", action_label: "연락",
      source_type: "followup", source_id: f.id, member_name: f.member_name });
  }

  // E/F. 회원 스냅샷 기반(있을 때만): 만료 D-14/7/3, 미방문 7/14/21, 신규 D+3/7
  for (const s of i.snapshots) {
    const dToEnd = s.end_date ? dayDiff(s.end_date, i.date) : null; // 양수=남은 일수
    if (dToEnd !== null && dToEnd >= 0 && dToEnd <= 14) {
      const tag = dToEnd <= 3 ? "d3" : dToEnd <= 7 ? "d7" : "d14";
      t.push({ generated_key: `exp_${s.id}_${tag}`, category: "followup", priority: dToEnd <= 7 ? "high" : "normal",
        title: `만료 D-${dToEnd} 재등록 상담: ${s.member_name}`, action_label: "연락", source_type: "member_snapshot", source_id: s.id, member_name: s.member_name, member_phone: s.phone ?? undefined });
    }
    const noVisit = daysSince(s.latest_visit_date, i.date);
    if (noVisit !== null && noVisit >= 7) {
      const tag = noVisit >= 21 ? "d21" : noVisit >= 14 ? "d14" : "d7";
      t.push({ generated_key: `novisit_${s.id}_${tag}`, category: "member_care", priority: noVisit >= 14 ? "high" : "normal",
        title: `${noVisit}일 미방문: ${s.member_name}`, action_label: "안부 연락", source_type: "member_snapshot", source_id: s.id, member_name: s.member_name, member_phone: s.phone ?? undefined });
    }
    const sinceStart = daysSince(s.start_date, i.date);
    if (sinceStart === 3 || sinceStart === 7) {
      t.push({ generated_key: `new_${s.id}_d${sinceStart}`, category: "member_care", priority: "normal",
        title: `신규 D+${sinceStart} 정착 체크: ${s.member_name}`, action_label: "안부", source_type: "member_snapshot", source_id: s.id, member_name: s.member_name, member_phone: s.phone ?? undefined });
    }
  }

  // G. PT
  for (const p of i.ptPasses) {
    if (p.status !== "active") continue;
    const remain = p.total_sessions - p.used_sessions;
    if (remain <= 0)
      t.push({ generated_key: `pt_done_${p.id}`, category: "pt", priority: "normal", title: `PT 완료 처리: ${p.member_name}`, action_label: "완료", source_type: "pt_pass", source_id: p.id, member_name: p.member_name });
    else if (remain <= 2)
      t.push({ generated_key: `pt_low_${p.id}`, category: "pt", priority: "high", title: `PT 추가등록 상담: ${p.member_name} (잔여 ${remain}회)`, action_label: "상담", source_type: "pt_pass", source_id: p.id, member_name: p.member_name });
  }

  // H. 문의/체험 (lead_inquiries, 있을 때만)
  for (const l of i.leads) {
    if (l.status === "inquiry" && !l.first_contact_at)
      t.push({ generated_key: `lead_reply_${l.id}`, category: "lead", priority: "urgent", title: `신규 문의 응대: ${l.lead_name}`, action_label: "응대", source_type: "lead", source_id: l.id, member_name: l.lead_name });
    if (l.status === "trial_booked" && l.trial_at && l.trial_at.slice(0, 10) === i.date)
      t.push({ generated_key: `trial_confirm_${l.id}`, category: "lead", priority: "high", title: `체험 방문 확인: ${l.lead_name}`, action_label: "확인", source_type: "lead", source_id: l.id, member_name: l.lead_name });
    if (l.status === "trial_done")
      t.push({ generated_key: `trial_reg_${l.id}`, category: "lead", priority: "high", title: `체험 후 등록 상담: ${l.lead_name}`, action_label: "상담", source_type: "lead", source_id: l.id, member_name: l.lead_name });
  }

  // J. 환불 처리
  for (const r of i.refunds) {
    const map: Record<string, { title: string; label: string }> = {
      waiting_member_agreement: { title: "환불 동의 답장 확인", label: "확인" },
      card_partial_cancel_pending: { title: "카드 부분취소 처리", label: "처리" },
      bank_transfer_pending: { title: "계좌환불 처리", label: "처리" },
    };
    const m = map[r.refund_status];
    if (m)
      t.push({ generated_key: `refund_${r.id}`, category: "refund", priority: "high", title: `${m.title}: ${r.member_name}`, action_label: m.label, source_type: "refund", source_id: r.id, member_name: r.member_name });
  }

  // K. 시설 이슈 (있을 때만)
  for (const s of i.issues) {
    if (s.status === "done" || s.status === "canceled") continue;
    if (s.severity === "urgent")
      t.push({ generated_key: `issue_${s.id}`, category: "facility", priority: "urgent", title: `긴급 시설/장비: ${s.title}`, action_label: "처리", source_type: "issue_ticket", source_id: s.id });
  }

  return t;
}

// ── 알림 생성 ──
export function generateAlerts(i: OpsInput): AlertDraft[] {
  const a: AlertDraft[] = [];
  // 리포트 미작성
  if (!i.report && i.afterCloseCutoff)
    a.push({ generated_key: "report_missing", severity: "danger", category: "report", title: "일일 리포트 미작성", message: "영업 종료 후에도 일일 리포트가 작성되지 않았습니다.", score_impact: -15 });
  // 마감 누락
  const closeUndone = CLOSE_NOS.some((n) => { const it = i.checklist.find((x) => x.no === n); return !it || !it.done; });
  if (closeUndone && i.afterCloseCutoff)
    a.push({ generated_key: "close_missing", severity: "warning", category: "checklist", title: "마감 점검 누락", message: "영업 종료 후 마감 점검이 완료되지 않았습니다.", score_impact: -5 });
  // 매출 진도
  if (i.monthlyTarget > 0) {
    const achieve = i.monthNetCumulative / i.monthlyTarget;
    const gap = i.monthProgressRatio - achieve; // 양수 = 진도 부족
    if (gap >= 0.25)
      a.push({ generated_key: "sales_gap_danger", severity: "danger", category: "sales", title: "월 목표 진도 심각", message: `월 목표 진도가 경과율 대비 ${Math.round(gap * 100)}%p 낮습니다.`, score_impact: -10 });
    else if (gap >= 0.15)
      a.push({ generated_key: "sales_gap_warn", severity: "warning", category: "sales", title: "월 목표 진도 부족", message: `월 목표 진도가 경과율 대비 ${Math.round(gap * 100)}%p 낮습니다.`, score_impact: -5 });
  }
  // 전환율: 문의는 있는데 신규 등록 0
  if (i.report && i.report.inquiry_count > 0 && i.report.new_signups === 0)
    a.push({ generated_key: "no_conversion", severity: "warning", category: "lead", title: "신규 전환 0", message: `오늘 문의 ${i.report.inquiry_count}건이 있었지만 신규 등록이 0건입니다.`, score_impact: -3 });
  // 만료 지났는데 진행중
  for (const f of i.followups)
    if (f.status === "진행중" && f.expire_date && dayDiff(f.expire_date, i.date) < 0)
      a.push({ generated_key: `followup_overdue_${f.id}`, severity: "warning", category: "followup", title: "만료 팔로업 지연", message: `${f.member_name} 회원 만료일이 지났는데 팔로업이 진행중입니다.`, source_type: "followup", source_id: f.id, score_impact: -2 });
  // PT 노쇼 누적
  for (const p of i.ptPasses)
    if (p.no_shows >= 2)
      a.push({ generated_key: `pt_noshow_${p.id}`, severity: "warning", category: "member", title: "PT 노쇼 누적", message: `${p.member_name} 회원 노쇼 ${p.no_shows}회 — 관리가 필요합니다.`, source_type: "pt_pass", source_id: p.id, score_impact: -2 });
  // 환불 위험/지연
  for (const r of i.refunds) {
    if (r.risk_level === "위험")
      a.push({ generated_key: `refund_risk_${r.id}`, severity: "danger", category: "refund", title: "환불 분쟁 위험", message: `${r.member_name} 환불 건 위험도가 높습니다 — 본사 확인 필요.`, source_type: "refund", source_id: r.id, score_impact: -5 });
    if (r.refund_requested_date && r.refund_status !== "completed" && businessDaysBetween(r.refund_requested_date, i.date) > 3)
      a.push({ generated_key: `refund_delay_${r.id}`, severity: "danger", category: "refund", title: "환불 처리 지연", message: `${r.member_name} 환불이 접수 후 3영업일을 초과했습니다 — 지연이자 위험.`, source_type: "refund", source_id: r.id, score_impact: -5 });
  }
  // 시설 이슈
  for (const s of i.issues) {
    if (s.status === "done" || s.status === "canceled") continue;
    if (s.severity === "urgent")
      a.push({ generated_key: `issue_urgent_${s.id}`, severity: "critical", category: "facility", title: "긴급 시설/장비 이슈", message: `${s.title} — 즉시 처리가 필요합니다.`, source_type: "issue_ticket", source_id: s.id, score_impact: -5 });
    const ageH = (Date.parse(i.nowIso) - Date.parse(s.created_at)) / 3600000;
    if (ageH >= 72)
      a.push({ generated_key: `issue_72_${s.id}`, severity: "danger", category: "facility", title: "시설 이슈 72시간 초과", message: `${s.title} 이슈가 72시간 이상 미처리 상태입니다.`, source_type: "issue_ticket", source_id: s.id, score_impact: -3 });
    else if (ageH >= 24)
      a.push({ generated_key: `issue_24_${s.id}`, severity: "warning", category: "facility", title: "시설 이슈 24시간 초과", message: `${s.title} 이슈가 24시간 이상 미처리 상태입니다.`, source_type: "issue_ticket", source_id: s.id, score_impact: -2 });
  }
  return a;
}

function businessDaysBetween(from: string, to: string): number {
  let d = new Date(`${from.slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  let n = 0;
  while (d.getTime() < end.getTime()) {
    d = new Date(d.getTime() + 86400000);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

// ── 운영 점수 (100점) ──
export function computeScore(i: OpsInput, tasks: TaskDraft[]): ScoreResult {
  const details: Record<string, unknown> = {};
  const reasons: string[] = [];

  // 리포트 15
  let report = i.report ? 15 : 0;
  if (!i.report) reasons.push("리포트 미작성");

  // 매출 진도 20
  let sales = 20;
  if (i.monthlyTarget > 0) {
    const achieve = i.monthNetCumulative / i.monthlyTarget;
    const gap = Math.max(0, i.monthProgressRatio - achieve);
    sales = Math.max(0, Math.round(20 * (1 - Math.min(1, gap / 0.3))));
    if (gap >= 0.15) reasons.push(`월 목표 진도 -${Math.round(gap * 100)}%p`);
  }

  // 오늘 태스크 완료율 20 — 생성된 태스크 중 미완료 비율로 추정(초안 기준 감점)
  const urgentOrHigh = tasks.filter((x) => x.priority === "urgent" || x.priority === "high").length;
  let task = Math.max(0, 20 - urgentOrHigh * 3);
  if (urgentOrHigh > 0) reasons.push(`긴급/높음 미처리 ${urgentOrHigh}건`);

  // 팔로업 15 (만료/회원관리 액션)
  const a1 = i.checklist.find((x) => x.no === 1)?.actual ?? 0;
  const a2 = i.checklist.find((x) => x.no === 2)?.actual ?? 0;
  const a3 = i.checklist.find((x) => x.no === 3)?.actual ?? 0;
  const careRatio = Math.min(1, (a1 + a2 + a3) / 8);
  const followup = Math.round(15 * careRatio);
  if (careRatio < 1) reasons.push(`회원관리 액션 ${a1 + a2 + a3}/8`);

  // CRM 10 (lead 미응대 감점)
  const leadPending = i.leads.filter((l) => l.status === "inquiry" && !l.first_contact_at).length;
  const lead = Math.max(0, 10 - leadPending * 3);
  if (leadPending > 0) reasons.push(`문의 미응대 ${leadPending}건`);

  // 오픈/마감 10
  const checkDone = [...OPEN_NOS, ...CLOSE_NOS].filter((n) => i.checklist.find((x) => x.no === n)?.done).length;
  const checklist = Math.round(10 * (checkDone / 8));
  if (checkDone < 8) reasons.push(`오픈/마감 체크 ${checkDone}/8`);

  // 환불 리스크 5
  const refundRisk = i.refunds.some((r) => r.risk_level === "위험");
  const refund = refundRisk ? 0 : 5;
  if (refundRisk) reasons.push("환불 분쟁 위험");

  // 시설 5
  const facilityOpen = i.issues.some((s) => s.severity === "urgent" && s.status !== "done" && s.status !== "canceled");
  const facility = facilityOpen ? 0 : 5;
  if (facilityOpen) reasons.push("긴급 시설 이슈");

  const total = report + sales + task + followup + lead + checklist + refund + facility;
  const grade: "safe" | "watch" | "danger" = total >= 85 ? "safe" : total >= 70 ? "watch" : "danger";
  const gradeKo = grade === "safe" ? "안전" : grade === "watch" ? "주의" : "위험";
  const summary = reasons.length
    ? `오늘 운영 점수는 ${total}점입니다. ${reasons.slice(0, 3).join(", ")}${reasons.length > 3 ? " 등" : ""}으로 ${gradeKo} 단계입니다.`
    : `오늘 운영 점수는 ${total}점입니다. 특이사항 없이 ${gradeKo} 단계입니다.`;
  details.reasons = reasons;
  return { total, report, sales, task, followup, lead, checklist, refund, facility, grade, summary, details };
}

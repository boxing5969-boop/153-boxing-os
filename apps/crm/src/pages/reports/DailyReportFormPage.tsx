import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  getDailyForm, saveDaily, saveChecklist, emptyReportFields,
  type DailyReport, type DailyReportFields, type ChecklistItem, type ReportSummary,
} from "@/services/dailyReports";
import { mergeChecklist } from "@/components/reports/checklistItems";
import { buildKakaoText } from "@/components/reports/buildKakaoText";

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function won(n: number): string {
  return n.toLocaleString("ko-KR");
}
function pickFields(r: DailyReport): DailyReportFields {
  return {
    revenue_pt: r.revenue_pt, revenue_membership: r.revenue_membership,
    revenue_goods: r.revenue_goods, revenue_dan: r.revenue_dan,
    inquiry_count: r.inquiry_count, new_signups: r.new_signups,
    re_signups: r.re_signups, pending_count: r.pending_count,
    pipeline_action_plan: r.pipeline_action_plan,
    morning_attendance: r.morning_attendance, lunch_attendance: r.lunch_attendance,
    evening_attendance: r.evening_attendance,
    morning_note: r.morning_note, lunch_note: r.lunch_note, evening_note: r.evening_note,
    inactive_contacted: r.inactive_contacted, inactive_reached: r.inactive_reached,
    inactive_returned: r.inactive_returned,
    promotion_candidates: r.promotion_candidates, facility_issue: r.facility_issue,
    decision_issue: r.decision_issue, decision_proposal: r.decision_proposal,
    decision_request: r.decision_request,
  };
}

interface BranchOpt { id: string; name: string; }

function NumField({ label, value, onChange, disabled }: {
  label: string; value: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type="number" min={0} inputMode="numeric" value={value} disabled={disabled}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
    </div>
  );
}
function TxtField({ label, value, onChange, disabled, placeholder }: {
  label: string; value: string | null; onChange: (v: string) => void; disabled?: boolean; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input value={value ?? ""} disabled={disabled} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {children}
      </CardContent>
    </Card>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-bold tabular", tone)}>{value}</p>
    </div>
  );
}

export default function DailyReportFormPage() {
  const { profile } = useAuth();
  const isHq = profile?.role === "super_admin" || profile?.role === "hq_admin";

  const [branches, setBranches] = useState<BranchOpt[]>([]);
  const [branchId, setBranchId] = useState<string>(profile?.branch_id ?? "");
  const [date, setDate] = useState<string>(todayKst());
  const [fields, setFields] = useState<DailyReportFields>(emptyReportFields());
  const [checklist, setChecklist] = useState<ChecklistItem[]>(mergeChecklist(null));
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [editable, setEditable] = useState(true);
  const [tab, setTab] = useState<"report" | "checklist">("report");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isHq && profile?.branch_id) { setBranchId(profile.branch_id); return; }
    void supabase.from("branches").select("id,name").order("name").then(({ data }) => {
      const list = (data ?? []) as BranchOpt[];
      setBranches(list);
      setBranchId((cur) => cur || (list[0]?.id ?? ""));
    });
  }, [isHq, profile?.branch_id]);

  const load = useCallback(async () => {
    if (!branchId) return;
    setErr(null); setMsg(null);
    try {
      const data = await getDailyForm(branchId, date);
      setFields(data.report ? pickFields(data.report) : emptyReportFields());
      setChecklist(mergeChecklist(data.checklist?.items ?? null));
      setSummary(data.summary);
      setEditable(data.editable);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "불러오기 실패");
    }
  }, [branchId, date]);

  useEffect(() => { void load(); }, [load]);

  function setF<K extends keyof DailyReportFields>(k: K, v: DailyReportFields[K]) {
    setFields((p) => ({ ...p, [k]: v }));
  }
  const dayTotal = fields.revenue_pt + fields.revenue_membership + fields.revenue_goods + fields.revenue_dan;

  async function onSave() {
    if (!branchId || !editable) return;
    setSaving(true); setErr(null); setMsg(null);
    try {
      await saveDaily({ ...fields, branch_id: branchId, report_date: date });
      await saveChecklist(branchId, date, checklist);
      setMsg("저장되었습니다"); setTimeout(() => setMsg(null), 2500);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }
  function onCopy() {
    if (!summary) return;
    const branchName = branches.find((b) => b.id === branchId)?.name ?? "153복싱짐";
    const text = buildKakaoText({ branchName, date, report: fields, summary });
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }

  const achievement = summary?.achievement != null ? `${Math.round(summary.achievement * 100)}%` : "—";

  return (
    <div className="space-y-5">
      {/* 헤더: 날짜·지점 + 저장/복사 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">일일 경영 성과 리포트</h1>
          <p className="text-sm text-muted-foreground">매일 입력 → 자동 계산 → 카톡 공유</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {(isHq || !profile?.branch_id) && (
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          <Button variant="outline" onClick={onCopy} disabled={!summary}>
            {copied ? "복사됨" : "카톡 텍스트 복사"}
          </Button>
          <Button onClick={onSave} disabled={saving || !editable}>{saving ? "저장 중…" : "저장"}</Button>
        </div>
      </div>

      {!editable && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          수정 허용 기간(작성일 당일·익일)이 지나 읽기 전용입니다.
        </p>
      )}
      {err && <p className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">{err}</p>}
      {msg && <p className="rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-sm text-success">{msg}</p>}

      {/* ① 목표/달성 자동 표시 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="당일 총매출" value={`${won(dayTotal)}원`} tone="text-primary" />
        <Stat label="월 누적" value={`${won(summary?.month_cumulative ?? 0)}원`} />
        <Stat label="월 목표" value={`${won(summary?.target_amount ?? 0)}원`} />
        <Stat label="달성률" value={achievement} tone="text-success" />
        <Stat label="Gap" value={`${won(summary?.gap ?? 0)}원`} tone={(summary?.gap ?? 0) > 0 ? "text-danger" : "text-success"} />
        <Stat label="D-Day" value={`D-${summary?.d_day ?? 0}`} />
      </div>

      {/* 탭 */}
      <div className="flex gap-2">
        {(["report", "checklist"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("rounded-lg px-3 py-1.5 text-sm font-medium",
              tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
            {t === "report" ? "리포트" : "오픈 체크리스트"}
          </button>
        ))}
      </div>

      {tab === "report" ? (
        <div className="space-y-4">
          {/* ② 매출 4분류 */}
          <Section title="② 매출 (원)">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <NumField label="복싱 PT" value={fields.revenue_pt} disabled={!editable} onChange={(v) => setF("revenue_pt", v)} />
              <NumField label="수강권" value={fields.revenue_membership} disabled={!editable} onChange={(v) => setF("revenue_membership", v)} />
              <NumField label="물품" value={fields.revenue_goods} disabled={!editable} onChange={(v) => setF("revenue_goods", v)} />
              <NumField label="단증/승단" value={fields.revenue_dan} disabled={!editable} onChange={(v) => setF("revenue_dan", v)} />
            </div>
          </Section>

          {/* ③ 영업 파이프라인 */}
          <Section title="③ 영업 파이프라인">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <NumField label="신규 문의" value={fields.inquiry_count} disabled={!editable} onChange={(v) => setF("inquiry_count", v)} />
              <NumField label="신규 등록" value={fields.new_signups} disabled={!editable} onChange={(v) => setF("new_signups", v)} />
              <NumField label="재등록" value={fields.re_signups} disabled={!editable} onChange={(v) => setF("re_signups", v)} />
              <NumField label="보류" value={fields.pending_count} disabled={!editable} onChange={(v) => setF("pending_count", v)} />
            </div>
            <TxtField label="액션 플랜" value={fields.pipeline_action_plan} disabled={!editable} onChange={(v) => setF("pipeline_action_plan", v)} />
          </Section>

          {/* ④ 타임별 현장 */}
          <Section title="④ 타임별 현장">
            <div className="grid grid-cols-3 gap-3">
              <NumField label="오전 출석" value={fields.morning_attendance} disabled={!editable} onChange={(v) => setF("morning_attendance", v)} />
              <NumField label="점심 출석" value={fields.lunch_attendance} disabled={!editable} onChange={(v) => setF("lunch_attendance", v)} />
              <NumField label="저녁 출석" value={fields.evening_attendance} disabled={!editable} onChange={(v) => setF("evening_attendance", v)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TxtField label="오전 메모" value={fields.morning_note} disabled={!editable} onChange={(v) => setF("morning_note", v)} />
              <TxtField label="점심 메모" value={fields.lunch_note} disabled={!editable} onChange={(v) => setF("lunch_note", v)} />
              <TxtField label="저녁 메모" value={fields.evening_note} disabled={!editable} onChange={(v) => setF("evening_note", v)} />
            </div>
          </Section>

          {/* ⑤ 회원관리 + 의사결정 */}
          <Section title="⑤ 회원관리 · 의사결정">
            <div className="grid grid-cols-3 gap-3">
              <NumField label="비활성 연락" value={fields.inactive_contacted} disabled={!editable} onChange={(v) => setF("inactive_contacted", v)} />
              <NumField label="연락 성공" value={fields.inactive_reached} disabled={!editable} onChange={(v) => setF("inactive_reached", v)} />
              <NumField label="복귀" value={fields.inactive_returned} disabled={!editable} onChange={(v) => setF("inactive_returned", v)} />
            </div>
            <TxtField label="승급 심사 대상" value={fields.promotion_candidates} disabled={!editable} onChange={(v) => setF("promotion_candidates", v)} />
            <TxtField label="시설 이슈" value={fields.facility_issue} disabled={!editable} onChange={(v) => setF("facility_issue", v)} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TxtField label="이슈" value={fields.decision_issue} disabled={!editable} onChange={(v) => setF("decision_issue", v)} />
              <TxtField label="제안" value={fields.decision_proposal} disabled={!editable} onChange={(v) => setF("decision_proposal", v)} />
              <TxtField label="요청" value={fields.decision_request} disabled={!editable} onChange={(v) => setF("decision_request", v)} />
            </div>
          </Section>
        </div>
      ) : (
        <Card>
          <CardContent className="pt-5 space-y-2">
            {checklist.map((it, idx) => (
              <div key={it.no} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <button type="button" disabled={!editable}
                  onClick={() => setChecklist((p) => p.map((x, i) => i === idx ? { ...x, done: !x.done } : x))}
                  className={cn("flex size-5 shrink-0 items-center justify-center rounded-md border text-xs",
                    it.done ? "bg-success text-white border-success" : "border-border")}>
                  {it.done ? "✓" : ""}
                </button>
                <span className={cn("flex-1 text-sm", it.done && "line-through text-muted-foreground")}>{it.label}</span>
                <Input className="w-40" placeholder="메모" value={it.memo} disabled={!editable}
                  onChange={(e) => setChecklist((p) => p.map((x, i) => i === idx ? { ...x, memo: e.target.value } : x))} />
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">※ 항목은 임시 표준안입니다. 실제 항목으로 교체 예정.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

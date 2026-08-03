import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, CheckCircle2, PencilLine, Sparkles } from "lucide-react";
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
import { getReportAutoStats, type ReportAutoStats } from "@/services/reportAutoStats";

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

// 큰 숫자 입력칸 — 관장님이 폰에서도 누르기 쉽게
function BigNumField({ label, value, onChange, disabled }: {
  label: string; value: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <Input type="number" min={0} inputMode="numeric" value={value} disabled={disabled}
        className="h-12 text-center text-lg font-bold tabular"
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

// 단계 섹션 — STEP 배지 + 쉬운 제목
function Step({ no, title, hint, children }: {
  no: string; title: string; hint?: string; children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground">
          {no}
        </span>
        <p className="text-sm font-bold text-foreground">{title}</p>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
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
  const [autoStats, setAutoStats] = useState<ReportAutoStats | null>(null);
  const [editable, setEditable] = useState(true);
  const [tab, setTab] = useState<"report" | "checklist">("report");
  const [showDetail, setShowDetail] = useState(false);
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

  // 검수 반영(boxer): 지점·날짜 빠른 전환 시 늦게 도착한 이전 응답이 화면을 덮으면
  // "새 날짜에 옛 숫자 저장" 오염이 생긴다 — 시퀀스 토큰으로 최신 요청만 반영.
  const loadSeq = useRef(0);
  // STEP 3 자동 펼침은 (지점|날짜) 별 최초 로드에서만 — 저장 후 재로드가 사용자의 접힘/펼침을 되돌리지 않게.
  const detailInitKey = useRef("");

  const load = useCallback(async () => {
    if (!branchId) return;
    const seq = ++loadSeq.current;
    setErr(null);
    try {
      const [data, auto] = await Promise.all([
        getDailyForm(branchId, date),
        getReportAutoStats(branchId, date).catch(() => null),
      ]);
      if (seq !== loadSeq.current) return; // 더 새 요청이 나감 — 이 응답은 폐기
      setFields(data.report ? pickFields(data.report) : emptyReportFields());
      // 저장된 상세 메모가 있으면 STEP 3을 자동으로 펼쳐서 보이게 (최초 1회)
      const r = data.report;
      const hasDetail = !!r && !!(
        r.pipeline_action_plan || r.morning_note || r.lunch_note || r.evening_note ||
        r.promotion_candidates || r.facility_issue ||
        r.decision_issue || r.decision_proposal || r.decision_request ||
        (r.inactive_contacted ?? 0) > 0 || (r.inactive_reached ?? 0) > 0 || (r.inactive_returned ?? 0) > 0
      );
      const key = `${branchId}|${date}`;
      if (detailInitKey.current !== key) {
        detailInitKey.current = key;
        setShowDetail(hasDetail);
      }
      setChecklist(mergeChecklist(data.checklist?.items ?? null));
      setSummary(data.summary);
      setEditable(data.editable);
      setAutoStats(auto);
    } catch (e) {
      if (seq !== loadSeq.current) return;
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
      await load();
      // 검수 반영: load() 이전에 setMsg 하면 배칭으로 한 프레임도 안 보인다 — 반드시 load 뒤에
      setMsg("저장되었습니다. 오늘도 수고하셨습니다!"); setTimeout(() => setMsg(null), 3000);
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
      {/* 헤더: 날짜·지점 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">오늘 경영 리포트</h1>
          <p className="text-sm text-muted-foreground">
            자동 숫자 확인 → 매출·등록만 입력 → 저장. 1분이면 끝나요.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {(isHq || !profile?.branch_id) && (
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm">
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        </div>
      </div>

      {!editable && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          수정 허용 기간(작성일 당일·익일)이 지나 읽기 전용입니다.
        </p>
      )}
      {err && <p className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">{err}</p>}
      {msg && (
        <p className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2.5 text-sm font-semibold text-success">
          <CheckCircle2 className="size-4" />{msg}
        </p>
      )}

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
          {/* STEP 1 — 자동으로 채워진 숫자, 확인만 */}
          <Step no="1" title="확인만 하세요" hint="브로제이 명부 기준으로 자동 집계된 숫자예요">
            {autoStats ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                <Stat label="오늘 출입" value={`${autoStats.accessSuccess}건`} tone="text-success" />
                <Stat label="출입 거절" value={`${autoStats.accessDenied}건`} tone={autoStats.accessDenied > 0 ? "text-danger" : undefined} />
                <Stat label="오늘 신규" value={`${autoStats.newMembers}명`} tone="text-primary" />
                <Stat label="7일내 만료" value={`${autoStats.expiringSoon}명`} tone={autoStats.expiringSoon > 0 ? "text-warning" : undefined} />
                <Stat label="미납" value={`${autoStats.unpaid}명`} tone={autoStats.unpaid > 0 ? "text-danger" : undefined} />
                <Stat label="활성 회원" value={`${autoStats.activeMembers}명`} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">자동 집계를 불러오는 중이거나, 아직 데이터가 없어요.</p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="오늘 매출" value={`${won(dayTotal)}원`} tone="text-primary" />
              <Stat label="이번달 누적" value={`${won(summary?.month_cumulative ?? 0)}원`} />
              <Stat label="이번달 목표" value={`${won(summary?.target_amount ?? 0)}원`} />
              <Stat label="달성률" value={achievement} tone="text-success" />
              <Stat label="목표까지" value={`${won(summary?.gap ?? 0)}원`} tone={(summary?.gap ?? 0) > 0 ? "text-danger" : "text-success"} />
              <Stat label="마감까지" value={`${summary?.d_day ?? 0}일`} />
            </div>
          </Step>

          {/* STEP 2 — 오늘 숫자만 입력 */}
          <Step no="2" title="오늘 숫자를 입력하세요" hint="숫자만 누르면 돼요">
            <p className="text-xs font-semibold text-muted-foreground">오늘 매출 (원)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <BigNumField label="복싱 PT" value={fields.revenue_pt} disabled={!editable} onChange={(v) => setF("revenue_pt", v)} />
              <BigNumField label="수강권" value={fields.revenue_membership} disabled={!editable} onChange={(v) => setF("revenue_membership", v)} />
              <BigNumField label="물품" value={fields.revenue_goods} disabled={!editable} onChange={(v) => setF("revenue_goods", v)} />
              <BigNumField label="단증 · 승단" value={fields.revenue_dan} disabled={!editable} onChange={(v) => setF("revenue_dan", v)} />
            </div>
            <p className="pt-1 text-xs font-semibold text-muted-foreground">상담 · 등록 (명)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <BigNumField label="오늘 문의" value={fields.inquiry_count} disabled={!editable} onChange={(v) => setF("inquiry_count", v)} />
              <BigNumField label="신규 등록" value={fields.new_signups} disabled={!editable} onChange={(v) => setF("new_signups", v)} />
              <BigNumField label="재등록" value={fields.re_signups} disabled={!editable} onChange={(v) => setF("re_signups", v)} />
              <BigNumField label="고민중 (보류)" value={fields.pending_count} disabled={!editable} onChange={(v) => setF("pending_count", v)} />
            </div>
            <p className="pt-1 text-xs font-semibold text-muted-foreground">시간대별 출석 (명)</p>
            <div className="grid grid-cols-3 gap-3">
              <BigNumField label="오전" value={fields.morning_attendance} disabled={!editable} onChange={(v) => setF("morning_attendance", v)} />
              <BigNumField label="점심" value={fields.lunch_attendance} disabled={!editable} onChange={(v) => setF("lunch_attendance", v)} />
              <BigNumField label="저녁" value={fields.evening_attendance} disabled={!editable} onChange={(v) => setF("evening_attendance", v)} />
            </div>
          </Step>

          {/* STEP 3 — 더 적을 게 있으면 (선택, 접힘) */}
          <Card>
            <CardContent className="pt-5">
              <button
                type="button"
                onClick={() => setShowDetail((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="flex items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-black text-muted-foreground">
                    3
                  </span>
                  <span className="text-sm font-bold text-foreground">더 적을 게 있다면</span>
                  <span className="text-xs text-muted-foreground">선택사항 — 없으면 건너뛰세요</span>
                </span>
                {showDetail ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
              </button>

              {showDetail && (
                <div className="mt-4 space-y-4">
                  <TxtField label="내일 할 일" value={fields.pipeline_action_plan} disabled={!editable}
                    placeholder="예: 보류 2명 다시 연락" onChange={(v) => setF("pipeline_action_plan", v)} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <TxtField label="오전 메모" value={fields.morning_note} disabled={!editable} onChange={(v) => setF("morning_note", v)} />
                    <TxtField label="점심 메모" value={fields.lunch_note} disabled={!editable} onChange={(v) => setF("lunch_note", v)} />
                    <TxtField label="저녁 메모" value={fields.evening_note} disabled={!editable} onChange={(v) => setF("evening_note", v)} />
                  </div>
                  <p className="text-xs font-semibold text-muted-foreground">쉬는 회원 연락 (명)</p>
                  <div className="grid grid-cols-3 gap-3">
                    <BigNumField label="연락함" value={fields.inactive_contacted} disabled={!editable} onChange={(v) => setF("inactive_contacted", v)} />
                    <BigNumField label="연락 닿음" value={fields.inactive_reached} disabled={!editable} onChange={(v) => setF("inactive_reached", v)} />
                    <BigNumField label="복귀함" value={fields.inactive_returned} disabled={!editable} onChange={(v) => setF("inactive_returned", v)} />
                  </div>
                  <TxtField label="승급 심사 대상" value={fields.promotion_candidates} disabled={!editable} onChange={(v) => setF("promotion_candidates", v)} />
                  <TxtField label="시설 이슈" value={fields.facility_issue} disabled={!editable}
                    placeholder="예: 샤워실 수압 약함" onChange={(v) => setF("facility_issue", v)} />
                  <p className="text-xs font-semibold text-muted-foreground">본사에 알릴 내용</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <TxtField label="이슈" value={fields.decision_issue} disabled={!editable} onChange={(v) => setF("decision_issue", v)} />
                    <TxtField label="제안" value={fields.decision_proposal} disabled={!editable} onChange={(v) => setF("decision_proposal", v)} />
                    <TxtField label="요청" value={fields.decision_request} disabled={!editable} onChange={(v) => setF("decision_request", v)} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 대형 저장 버튼 — 마지막 한 번만 누르면 끝 */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={onSave}
              disabled={saving || !editable}
              className="h-14 flex-1 gap-2 text-base font-bold"
            >
              <PencilLine className="size-5" />
              {saving ? "저장 중…" : "오늘 리포트 저장하기"}
            </Button>
            <Button
              variant="outline"
              onClick={onCopy}
              disabled={!summary}
              className="h-14 gap-2 text-base font-semibold sm:w-56"
            >
              <Sparkles className="size-5" />
              {copied ? "복사됐어요!" : "카톡으로 공유"}
            </Button>
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="pt-5 space-y-2">
            {checklist.map((it, idx) => (
              <div key={it.no} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <button type="button" disabled={!editable}
                  onClick={() => setChecklist((p) => p.map((x, i) => i === idx ? { ...x, done: !x.done } : x))}
                  className={cn("flex size-6 shrink-0 items-center justify-center rounded-md border text-xs",
                    it.done ? "bg-success text-white border-success" : "border-border")}>
                  {it.done ? "✓" : ""}
                </button>
                <span className={cn("flex-1 text-sm", it.done && "line-through text-muted-foreground")}>{it.label}</span>
                <Input className="w-40" placeholder="메모" value={it.memo} disabled={!editable}
                  onChange={(e) => setChecklist((p) => p.map((x, i) => i === idx ? { ...x, memo: e.target.value } : x))} />
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">※ 항목은 임시 표준안입니다. 실제 항목으로 교체 예정.</p>
            <Button onClick={onSave} disabled={saving || !editable} className="mt-2 h-12 w-full font-bold">
              {saving ? "저장 중…" : "체크리스트 저장하기"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

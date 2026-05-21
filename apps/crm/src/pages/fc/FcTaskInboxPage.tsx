/**
 * FC 업무함 — 3차
 * 두 영역: ① 처리 대기 업무카드(tasks)  ② 승인 대기 메시지 초안(message_suggestions)
 * FC 액션: 업무 완료 / 연락 기록 / 메시지 초안 승인·반려.
 * 메시지 "승인"은 발송이 아니라 approved 상태 전환까지만 — 자동발송 없음.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList, MessageSquareText, CheckCircle2, PhoneCall,
  ThumbsUp, ThumbsDown, AlarmClock, Sparkles, Send, ShieldAlert,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import {
  listFcTasks, completeTask, listMessageDrafts,
  approveMessageDraft, rejectMessageDraft, logContact,
  regenerateMessage, sendApprovedMessage,
  type FcTask, type MessageDraft, type ContactChannel, type ContactResult,
} from "@/services/fcCare";

const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  urgent: { label: "긴급", cls: "bg-danger/10 text-danger" },
  high:   { label: "높음", cls: "bg-warning/10 text-warning" },
  normal: { label: "보통", cls: "bg-muted text-muted-foreground" },
  low:    { label: "낮음", cls: "bg-muted text-muted-foreground" },
};

const TASK_TYPE_LABEL: Record<string, string> = {
  renewal: "재등록", unpaid: "미납", no_show: "미출석",
  low_satisfaction: "만족도", complaint: "불만", follow_up: "팔로업",
  no_show_recovery: "복귀 유도", pt_conversion: "PT 전환",
  praise: "칭찬", referral: "추천", onboarding: "온보딩", other: "기타",
};

const CONTACT_CHANNELS: ContactChannel[] = ["kakao", "sms", "call", "visit", "push"];
const CONTACT_RESULTS: { v: ContactResult; label: string }[] = [
  { v: "sent", label: "발송함" }, { v: "no_answer", label: "부재" },
  { v: "replied", label: "답장옴" }, { v: "booked", label: "예약" },
  { v: "visited", label: "방문" }, { v: "renewed", label: "재등록" },
  { v: "pt_purchased", label: "PT 구매" }, { v: "failed", label: "실패" },
];

function won(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}

// ── 연락 기록 다이얼로그 ──────────────────────────────────────
function ContactDialog({
  task, onClose, onSaved,
}: {
  task: FcTask;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const [channel, setChannel] = useState<ContactChannel>("kakao");
  const [result, setResult] = useState<ContactResult>("sent");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!task.member_id) { setErr("회원이 연결되지 않은 업무입니다."); return; }
    setSaving(true);
    setErr(null);
    try {
      await logContact({
        branch_id: task.branch_id,
        member_id: task.member_id,
        fc_task_id: task.id,
        staff_id: profile?.id ?? null,
        channel, result, note: note.trim() || undefined,
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  const fieldCls =
    "w-full h-10 rounded-md border border-border bg-background px-3 text-sm";

  return (
    <Dialog open onClose={onClose} title={`연락 기록 — ${task.member_name ?? "회원"}`}>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">연락 수단</label>
          <select className={fieldCls} value={channel}
            onChange={(e) => setChannel(e.target.value as ContactChannel)}>
            {CONTACT_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">결과</label>
          <select className={fieldCls} value={result}
            onChange={(e) => setResult(e.target.value as ContactResult)}>
            {CONTACT_RESULTS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">메모</label>
          <textarea
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="통화 내용·다음 약속 등" />
        </div>
        {err && <p className="text-xs text-danger">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>취소</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "저장 중…" : "기록 저장"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ── 업무카드 ──────────────────────────────────────────────────
function TaskCard({
  task, onComplete, onContact,
}: {
  task: FcTask;
  onComplete: (id: string) => void;
  onContact: (t: FcTask) => void;
}) {
  const pr = PRIORITY_META[task.priority] ?? PRIORITY_META.normal;
  return (
    <Card>
      <CardContent className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", pr.cls)}>
                {pr.label}
              </span>
              <span className="text-[10px] font-medium text-muted-foreground">
                {TASK_TYPE_LABEL[task.task_type] ?? task.task_type}
              </span>
            </div>
            <p className="mt-1 text-sm font-bold text-foreground truncate">{task.title}</p>
            {task.member_name && (
              <p className="text-xs text-muted-foreground">회원: {task.member_name}</p>
            )}
          </div>
          {task.due_date && (
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <AlarmClock className="size-3" />{task.due_date}
            </span>
          )}
        </div>

        {task.reason && (
          <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-foreground">
            <span className="font-semibold">사유 </span>{task.reason}
          </p>
        )}
        {task.recommended_action && (
          <p className="text-xs text-foreground">
            <span className="font-semibold text-primary">추천 행동 </span>
            {task.recommended_action}
          </p>
        )}
        {task.recommended_message && (
          <p className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground whitespace-pre-wrap">
            {task.recommended_message}
          </p>
        )}
        {task.expected_value != null && Number(task.expected_value) > 0 && (
          <p className="text-xs font-semibold text-success">
            기대값 {won(Number(task.expected_value))}
          </p>
        )}

        <div className="flex gap-2 pt-0.5">
          <Button variant="outline" size="sm" onClick={() => onContact(task)}>
            <PhoneCall className="size-3.5" />연락 기록
          </Button>
          <Button size="sm" onClick={() => onComplete(task.id)}>
            <CheckCircle2 className="size-3.5" />완료
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── 메시지 초안 카드 ──────────────────────────────────────────
function DraftCard({
  draft, busy, onApprove, onReject, onRegenerate, onSend,
}: {
  draft: MessageDraft;
  busy: boolean;
  onApprove: (id: string, force: boolean) => void;
  onReject: (id: string) => void;
  onRegenerate: (id: string) => void;
  onSend: (id: string) => void;
}) {
  const isBlocked = draft.safety_status === "block";
  const isWarn = draft.safety_status === "warn";
  const isApproved = draft.status === "approved";
  const terms = draft.safety_flags.map((f) => f.term).join(", ");

  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-foreground truncate">
            {draft.member_name ?? "회원"}
          </p>
          <span className="flex items-center gap-1.5">
            {isApproved && (
              <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-bold text-success">
                승인됨
              </span>
            )}
            <span className="text-[10px] font-medium text-muted-foreground uppercase">
              {draft.channel ?? "sms"}
            </span>
          </span>
        </div>
        {draft.generation_reason && (
          <p className="text-[11px] text-muted-foreground">{draft.generation_reason}</p>
        )}
        <p className="rounded-md bg-muted/60 px-2.5 py-2 text-xs text-foreground whitespace-pre-wrap">
          {draft.generated_body || "(내용 없음)"}
        </p>

        {(isBlocked || isWarn) && (
          <p className={cn(
            "flex items-start gap-1 rounded-md px-2 py-1.5 text-[11px]",
            isBlocked ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning",
          )}>
            <ShieldAlert className="mt-0.5 size-3 shrink-0" />
            <span>
              {isBlocked
                ? "외모·압박성 표현이 감지되어 일반 승인이 차단됩니다."
                : "압박성 표현이 감지되었습니다. 확인 후 승인하세요."}
              {terms && <span className="opacity-80"> ({terms})</span>}
            </span>
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-0.5">
          {isApproved ? (
            <Button size="sm" disabled={busy} onClick={() => onSend(draft.id)}>
              <Send className="size-3.5" />발송
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" disabled={busy}
                onClick={() => onReject(draft.id)}>
                <ThumbsDown className="size-3.5" />반려
              </Button>
              <Button variant="outline" size="sm" disabled={busy}
                onClick={() => onRegenerate(draft.id)}>
                <Sparkles className="size-3.5" />AI 재생성
              </Button>
              {isBlocked ? (
                <Button variant="destructive" size="sm" disabled={busy}
                  onClick={() => onApprove(draft.id, true)}>
                  <ShieldAlert className="size-3.5" />관리자 강제 승인
                </Button>
              ) : (
                <Button size="sm" disabled={busy}
                  onClick={() => onApprove(draft.id, false)}>
                  <ThumbsUp className="size-3.5" />승인
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════
function notifyError(e: unknown, fallback: string) {
  window.alert(e instanceof Error ? e.message : fallback);
}

export default function FcTaskInboxPage() {
  const qc = useQueryClient();
  const [contactTask, setContactTask] = useState<FcTask | null>(null);

  const tasksQuery = useQuery({ queryKey: ["fc-tasks"], queryFn: listFcTasks });
  const draftsQuery = useQuery({ queryKey: ["fc-drafts"], queryFn: listMessageDrafts });

  const invalidateDrafts = () => qc.invalidateQueries({ queryKey: ["fc-drafts"] });

  const completeMut = useMutation({
    mutationFn: completeTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fc-tasks"] }),
    onError: (e) => notifyError(e, "완료 처리 실패"),
  });
  const approveMut = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) =>
      approveMessageDraft(id, force),
    onSuccess: invalidateDrafts,
    onError: (e) => notifyError(e, "승인 실패"),
  });
  const rejectMut = useMutation({
    mutationFn: rejectMessageDraft,
    onSuccess: invalidateDrafts,
    onError: (e) => notifyError(e, "반려 실패"),
  });
  const regenerateMut = useMutation({
    mutationFn: regenerateMessage,
    onSuccess: invalidateDrafts,
    onError: (e) => notifyError(e, "AI 재생성 실패"),
  });
  const sendMut = useMutation({
    mutationFn: sendApprovedMessage,
    onSuccess: invalidateDrafts,
    onError: (e) => notifyError(e, "발송 실패"),
  });
  const draftBusy =
    approveMut.isPending || rejectMut.isPending ||
    regenerateMut.isPending || sendMut.isPending;

  const tasks = tasksQuery.data ?? [];
  const drafts = draftsQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-foreground">FC 업무함</h1>
        <p className="text-sm text-muted-foreground">
          오늘 처리할 회원 케어 업무와 승인 대기 메시지
        </p>
      </div>

      {/* 업무카드 */}
      <section className="space-y-2.5">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <ClipboardList className="size-4" />처리 대기 업무
          <span className="text-xs font-medium text-muted-foreground">({tasks.length})</span>
        </h2>
        {tasksQuery.isLoading && (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        )}
        {tasksQuery.isError && (
          <p className="text-sm text-danger">업무를 불러오지 못했습니다.</p>
        )}
        {!tasksQuery.isLoading && !tasksQuery.isError && tasks.length === 0 && (
          <p className="text-sm text-muted-foreground">처리할 업무가 없습니다.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t}
              onComplete={(id) => completeMut.mutate(id)}
              onContact={setContactTask} />
          ))}
        </div>
      </section>

      {/* 메시지 초안 */}
      <section className="space-y-2.5">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <MessageSquareText className="size-4" />승인 대기 메시지
          <span className="text-xs font-medium text-muted-foreground">({drafts.length})</span>
        </h2>
        {!draftsQuery.isLoading && drafts.length === 0 && (
          <p className="text-sm text-muted-foreground">승인 대기 중인 메시지가 없습니다.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {drafts.map((d) => (
            <DraftCard key={d.id} draft={d} busy={draftBusy}
              onApprove={(id, force) => approveMut.mutate({ id, force })}
              onReject={(id) => rejectMut.mutate(id)}
              onRegenerate={(id) => regenerateMut.mutate(id)}
              onSend={(id) => sendMut.mutate(id)} />
          ))}
        </div>
      </section>

      {contactTask && (
        <ContactDialog
          task={contactTask}
          onClose={() => setContactTask(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["fc-tasks"] })}
        />
      )}
    </div>
  );
}

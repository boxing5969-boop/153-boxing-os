import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Clock, CheckCircle, XCircle, AlertTriangle, Ban,
  Calendar, Users, User, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listScheduledMessages,
  createScheduledMessage,
  cancelScheduledMessage,
  listTemplates,
  type ScheduledMessage,
  type MsgChannel,
} from "@/services/messaging";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";

// ── 상수 ────────────────────────────────────────────────────
const CHANNEL_LABEL: Record<MsgChannel, string> = {
  sms:               "문자(SMS)",
  kakao:             "카카오",
  both:              "문자 + 카카오",
  kakao_sms_fallback:"카카오→SMS",
};

const STATUS_STYLE: Record<ScheduledMessage["status"], string> = {
  pending:    "bg-blue-50 text-blue-700",
  processing: "bg-warning/10 text-warning",
  sent:       "bg-success/10 text-success",
  failed:     "bg-danger/10 text-danger",
  cancelled:  "bg-muted text-muted-foreground",
};
const STATUS_LABEL: Record<ScheduledMessage["status"], string> = {
  pending:    "대기",
  processing: "발송 중",
  sent:       "발송 완료",
  failed:     "실패",
  cancelled:  "취소됨",
};
const STATUS_ICON: Record<ScheduledMessage["status"], ReactNode> = {
  pending:    <Clock className="size-3.5" />,
  processing: <span className="size-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin inline-block" />,
  sent:       <CheckCircle className="size-3.5" />,
  failed:     <XCircle className="size-3.5" />,
  cancelled:  <Ban className="size-3.5" />,
};

// ── 변수 치환자 ─────────────────────────────────────────────
const VAR_CHIPS = ["#{회원명}", "#{만료일}", "#{남은일수}", "#{지점명}", "#{플랜명}"];
const CHANNEL_OPTIONS: MsgChannel[] = ["kakao", "sms", "both", "kakao_sms_fallback"];

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function toLocalIsoString(d: Date) {
  // yyyy-MM-ddTHH:mm
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── 폼 타입 ─────────────────────────────────────────────────
interface FormState {
  name: string;
  content: string;
  channel: MsgChannel;
  target_type: "member" | "group";
  target_days_ahead: string;
  scheduled_at: string;
}

function defaultScheduledAt() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return toLocalIsoString(d);
}

const EMPTY_FORM: FormState = {
  name: "",
  content: "",
  channel: "kakao",
  target_type: "group",
  target_days_ahead: "7",
  scheduled_at: defaultScheduledAt(),
};

// ── 메인 컴포넌트 ────────────────────────────────────────────
export default function ScheduledMessagesPage() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id ?? "";
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [templateMode, setTemplateMode] = useState(false);

  const { data: msgs = [], isLoading } = useQuery({
    queryKey: ["scheduled-msgs", branchId],
    queryFn: () => listScheduledMessages(branchId),
    enabled: !!branchId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["msg-templates", branchId],
    queryFn: () => listTemplates(branchId),
    enabled: !!branchId && showForm,
    staleTime: 60_000,
  });

  const createMut = useMutation({
    mutationFn: () => {
      const scheduled_at = new Date(form.scheduled_at).toISOString();
      return createScheduledMessage({
        branch_id: branchId,
        name: form.name.trim(),
        content: form.content.trim(),
        channel: form.channel,
        target_type: form.target_type,
        target_days_ahead: form.target_type === "group" ? Number(form.target_days_ahead) : undefined,
        scheduled_at,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-msgs", branchId] });
      closeForm();
    },
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelScheduledMessage(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-msgs", branchId] });
      setConfirmCancel(null);
    },
  });

  function closeForm() {
    setShowForm(false);
    setForm({ ...EMPTY_FORM, scheduled_at: defaultScheduledAt() });
    setTemplateMode(false);
  }

  function applyTemplate(t: { name: string; content: string; channel: MsgChannel }) {
    setForm(f => ({ ...f, name: t.name, content: t.content, channel: t.channel }));
    setTemplateMode(false);
  }

  function insertVar(v: string) {
    setForm(f => ({ ...f, content: f.content + v }));
  }

  const canSubmit = form.name.trim() && form.content.trim() && form.scheduled_at;
  const isSaving = createMut.isPending;

  // 상태별 집계
  const pending = msgs.filter(m => m.status === "pending").length;
  const sent    = msgs.filter(m => m.status === "sent").length;
  const failed  = msgs.filter(m => m.status === "failed").length;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-foreground">예약 발송</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            원하는 날짜·시간에 자동으로 문자/카카오를 발송합니다.
          </p>
        </div>
        {!showForm && (
          <Button className="gap-2 shrink-0" onClick={() => setShowForm(true)}>
            <Plus className="size-4" /> 예약 만들기
          </Button>
        )}
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="대기 중" value={pending} color="blue" />
        <SummaryCard label="발송 완료" value={sent} color="success" />
        <SummaryCard label="실패" value={failed} color={failed > 0 ? "danger" : "default"} />
      </div>

      {/* 예약 폼 */}
      {showForm && (
        <div className="rounded-xl border border-primary/30 bg-card p-5 shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground">새 예약 발송</h2>
            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => setTemplateMode(!templateMode)}>
              <MessageSquare className="size-3.5" />
              {templateMode ? "직접 입력" : "템플릿에서 불러오기"}
            </Button>
          </div>

          {/* 템플릿 선택 */}
          {templateMode && (
            <div className="space-y-2">
              {templates.filter(t => t.is_active).length === 0 ? (
                <p className="text-xs text-muted-foreground">저장된 활성 템플릿이 없습니다.</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {templates.filter(t => t.is_active).map(t => (
                    <button
                      key={t.id}
                      onClick={() => applyTemplate(t)}
                      className="w-full text-left rounded-lg border border-border px-3 py-2 hover:border-primary/40 hover:bg-muted/40 transition-all"
                    >
                      <p className="text-sm font-medium text-foreground">{t.name}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1">{t.content}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 이름 */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">발송 이름 (관리용)</label>
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="예: 5월 만료 예정 회원 안내"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          {/* 채널 + 대상 유형 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">발송 채널</label>
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={form.channel}
                onChange={e => setForm(f => ({ ...f, channel: e.target.value as MsgChannel }))}
              >
                {CHANNEL_OPTIONS.map(c => (
                  <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">발송 대상</label>
              <div className="flex gap-2">
                {(["group", "member"] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setForm(f => ({ ...f, target_type: type }))}
                    className={cn(
                      "flex-1 rounded-lg border py-2 text-xs font-medium transition-all flex items-center justify-center gap-1",
                      form.target_type === type
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    {type === "group" ? <Users className="size-3.5" /> : <User className="size-3.5" />}
                    {type === "group" ? "그룹" : "개인"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 그룹: 만료 기준일 */}
          {form.target_type === "group" && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                만료 예정 기간 (발송 시점 기준 N일 이내)
              </label>
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={form.target_days_ahead}
                onChange={e => setForm(f => ({ ...f, target_days_ahead: e.target.value }))}
              >
                {[1,3,7,14,30].map(d => (
                  <option key={d} value={String(d)}>{d}일 이내 만료 예정</option>
                ))}
              </select>
            </div>
          )}

          {/* 내용 */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">메시지 내용</label>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {VAR_CHIPS.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVar(v)}
                  className="rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                >
                  {v}
                </button>
              ))}
            </div>
            <textarea
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
              placeholder="메시지 내용을 입력하세요."
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            />
            <p className="text-[11px] text-muted-foreground">
              {new TextEncoder().encode(form.content).length}바이트
              {new TextEncoder().encode(form.content).length > 90 ? " → LMS 발송" : " → SMS 발송"}
            </p>
          </div>

          {/* 발송 시각 */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">발송 예정 시각</label>
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-muted-foreground shrink-0" />
              <input
                type="datetime-local"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={form.scheduled_at}
                min={toLocalIsoString(new Date())}
                onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              설정한 시각 이후 최대 1시간 내에 발송됩니다 (매시 정각 처리).
            </p>
          </div>

          {createMut.error && (
            <p className="text-xs text-danger">
              {createMut.error instanceof Error ? createMut.error.message : "저장 실패"}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button disabled={!canSubmit || isSaving} onClick={() => createMut.mutate()}>
              {isSaving ? "저장 중…" : "예약 등록"}
            </Button>
            <Button variant="ghost" onClick={closeForm}>취소</Button>
          </div>
        </div>
      )}

      {/* 예약 목록 */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-sm opacity-50">불러오는 중…</div>
      ) : msgs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 p-16 text-muted-foreground rounded-xl border border-dashed border-border">
          <Clock className="size-8 opacity-30" />
          <p className="text-sm">예약된 발송이 없습니다.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">이름</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">채널</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">대상</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">예약 시각</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">상태</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">결과</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {msgs.map(m => (
                <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{m.name}</p>
                    <p className="text-[11px] text-muted-foreground line-clamp-1">{m.content}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {CHANNEL_LABEL[m.channel]}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {m.target_type === "group"
                      ? `그룹 (${m.target_days_ahead}일 이내)`
                      : "개인"}
                  </td>
                  <td className="px-4 py-3 text-xs tabular text-muted-foreground whitespace-nowrap">
                    {formatDateTime(m.scheduled_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                      STATUS_STYLE[m.status]
                    )}>
                      {STATUS_ICON[m.status]}
                      {STATUS_LABEL[m.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {m.status === "sent" && (
                      <span className="text-success font-medium">{m.sent_count}건 성공</span>
                    )}
                    {m.status === "failed" && m.error_message && (
                      <span className="text-danger" title={m.error_message}>오류</span>
                    )}
                    {(m.status === "pending" || m.status === "processing") && (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.status === "pending" && (
                      confirmCancel === m.id ? (
                        <div className="flex items-center gap-1 justify-end">
                          <p className="text-xs text-danger">취소?</p>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={cancelMut.isPending}
                            onClick={() => cancelMut.mutate(m.id)}
                          >
                            {cancelMut.isPending ? "…" : "확인"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(null)}>
                            아니오
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-danger"
                          onClick={() => setConfirmCancel(m.id)}
                        >
                          <Ban className="size-3.5 mr-1" /> 취소
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 요약 카드 ─────────────────────────────────────────────
function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  const textColor = color === "success" ? "text-success"
    : color === "danger" ? "text-danger"
    : color === "blue" ? "text-blue-600"
    : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-black tabular", textColor)}>{value}</p>
    </div>
  );
}

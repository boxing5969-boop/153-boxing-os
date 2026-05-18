import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, FileText, ToggleLeft, ToggleRight,
  MessageSquare, Phone, Layers,
} from "lucide-react";
import SmsPhonePreview, { calcBytes, getMsgType } from "@/components/messaging/SmsPhonePreview";
import { Button } from "@/components/ui/button";
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  type MessageTemplate,
  type MsgChannel,
} from "@/services/messaging";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";

// ── 채널 레이블 ─────────────────────────────────────────────
const CHANNEL_LABEL: Record<MsgChannel, string> = {
  sms:               "문자(SMS)",
  kakao:             "카카오 알림톡",
  both:              "문자 + 카카오",
  kakao_sms_fallback:"카카오 (실패 시 SMS)",
};
const CHANNEL_COLOR: Record<MsgChannel, string> = {
  sms:               "bg-blue-50 text-blue-700",
  kakao:             "bg-yellow-50 text-yellow-700",
  both:              "bg-purple-50 text-purple-700",
  kakao_sms_fallback:"bg-orange-50 text-orange-700",
};

// ── 트리거 유형 ─────────────────────────────────────────────
const TRIGGER_OPTIONS = [
  { value: "",          label: "수동 (자동 트리거 없음)" },
  { value: "expiry_d7", label: "만료 7일 전 (D-7)" },
  { value: "expiry_d3", label: "만료 3일 전 (D-3)" },
  { value: "expiry_d1", label: "만료 1일 전 (D-1)" },
  { value: "expiry_d0", label: "만료 당일 (D-0)" },
  { value: "expiry_dp7","label": "만료 후 7일 (D+7)" },
];

// ── 변수 치환자 ─────────────────────────────────────────────
const VAR_CHIPS = [
  "#{회원명}", "#{만료일}", "#{남은일수}", "#{지점명}", "#{플랜명}",
];

// ── 채널 옵션 ────────────────────────────────────────────────
const CHANNEL_OPTIONS: MsgChannel[] = ["kakao", "sms", "both", "kakao_sms_fallback"];

// ── 폼 초기값 ─────────────────────────────────────────────
interface FormState {
  name: string;
  content: string;
  channel: MsgChannel;
  trigger_type: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  content: "",
  channel: "kakao",
  trigger_type: "",
  is_active: true,
};

// ── 메인 컴포넌트 ────────────────────────────────────────────
export default function MessageTemplatesPage() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id ?? "";
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["msg-templates", branchId],
    queryFn: () => listTemplates(branchId),
    enabled: !!branchId,
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: (input: Omit<MessageTemplate, "id" | "created_at">) => createTemplate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["msg-templates", branchId] });
      closeForm();
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateTemplate>[1] }) =>
      updateTemplate(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["msg-templates", branchId] });
      closeForm();
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["msg-templates", branchId] });
      setConfirmDelete(null);
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      updateTemplate(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["msg-templates", branchId] }),
  });

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(t: MessageTemplate) {
    setEditing(t);
    setForm({
      name: t.name,
      content: t.content,
      channel: t.channel,
      trigger_type: t.trigger_type ?? "",
      is_active: t.is_active,
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function insertVar(v: string) {
    setForm(f => ({ ...f, content: f.content + v }));
  }

  function handleSubmit() {
    if (!form.name.trim() || !form.content.trim()) return;
    const payload = {
      branch_id: branchId,
      name: form.name.trim(),
      content: form.content.trim(),
      channel: form.channel,
      trigger_type: form.trigger_type || null,
      is_active: form.is_active,
    };
    if (editing) {
      updateMut.mutate({ id: editing.id, patch: payload });
    } else {
      createMut.mutate(payload);
    }
  }

  const isSaving = createMut.isPending || updateMut.isPending;
  const saveError = createMut.error ?? updateMut.error;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-foreground">메시지 템플릿</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            자주 쓰는 메시지를 저장하고 빠르게 재사용하세요.
          </p>
        </div>
        {!showForm && (
          <Button className="gap-2 shrink-0" onClick={openNew}>
            <Plus className="size-4" /> 새 템플릿
          </Button>
        )}
      </div>

      {/* 템플릿 작성 / 수정 폼 */}
      {showForm && (
        <div className="rounded-xl border border-primary/30 bg-card p-5 shadow-card">
          <div className="grid grid-cols-[1fr_auto] gap-6 items-start">
            {/* ── 좌측: 폼 필드 ── */}
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-foreground">
                {editing ? "템플릿 수정" : "새 템플릿 작성"}
              </h2>

              {/* 이름 */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">템플릿 이름</label>
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="예: D-7 만료 예정 안내"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              {/* 채널 + 트리거 */}
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
                  <label className="text-xs font-medium text-muted-foreground">자동 트리거 (선택)</label>
                  <select
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    value={form.trigger_type}
                    onChange={e => setForm(f => ({ ...f, trigger_type: e.target.value }))}
                  >
                    {TRIGGER_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

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
                  rows={5}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                  placeholder={"안녕하세요 #{회원명}님, #{지점명}입니다.\n#{플랜명} 이용권이 #{남은일수}일 후 만료됩니다.\n문의: 031-XXX-XXXX"}
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                />
                {/* 바이트 + 타입 배지 */}
                <div className="flex items-center gap-2">
                  {(() => {
                    const b = calcBytes(form.content);
                    const t = getMsgType(form.channel, b, false);
                    const badge = t === "SMS" ? "bg-blue-50 text-blue-700"
                      : t === "LMS" ? "bg-amber-50 text-amber-700"
                      : t === "KAKAO" ? "bg-yellow-50 text-yellow-700"
                      : "bg-purple-50 text-purple-700";
                    return (
                      <>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}`}>{t}</span>
                        <span className="text-[11px] text-muted-foreground">{b}바이트</span>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* 활성화 토글 */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                />
                {form.is_active
                  ? <ToggleRight className="size-5 text-primary" />
                  : <ToggleLeft className="size-5 text-muted-foreground" />}
                <span className="text-sm text-foreground">
                  {form.is_active ? "활성화 상태" : "비활성화 상태"}
                </span>
              </label>

              {saveError && (
                <p className="text-xs text-danger">{saveError instanceof Error ? saveError.message : "저장 실패"}</p>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  disabled={isSaving || !form.name.trim() || !form.content.trim()}
                  onClick={handleSubmit}
                >
                  {isSaving ? "저장 중…" : editing ? "수정 저장" : "템플릿 추가"}
                </Button>
                <Button variant="ghost" onClick={closeForm}>취소</Button>
              </div>
            </div>

            {/* ── 우측: 폰 미리보기 ── */}
            <div className="sticky top-4 pt-6">
              <p className="text-[11px] text-center text-muted-foreground mb-2">미리보기</p>
              <SmsPhonePreview
                content={form.content}
                channel={form.channel}
                senderName="153복싱짐"
              />
            </div>
          </div>
        </div>
      )}

      {/* 템플릿 목록 */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-sm opacity-50">불러오는 중…</div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 p-16 text-muted-foreground rounded-xl border border-dashed border-border">
          <FileText className="size-8 opacity-30" />
          <p className="text-sm">저장된 템플릿이 없습니다.</p>
          <p className="text-xs opacity-70">새 템플릿을 만들어 빠르게 재사용하세요.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <TemplateCard
              key={t.id}
              template={t}
              onEdit={() => openEdit(t)}
              onDelete={() => setConfirmDelete(t.id)}
              onToggle={() => toggleMut.mutate({ id: t.id, is_active: !t.is_active })}
              toggling={toggleMut.isPending}
              confirmingDelete={confirmDelete === t.id}
              onConfirmDelete={() => deleteMut.mutate(t.id)}
              onCancelDelete={() => setConfirmDelete(null)}
              deleting={deleteMut.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── 템플릿 카드 ─────────────────────────────────────────────
interface TemplateCardProps {
  template: MessageTemplate;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  toggling: boolean;
  confirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  deleting: boolean;
}

function TemplateCard({
  template: t,
  onEdit, onDelete, onToggle, toggling,
  confirmingDelete, onConfirmDelete, onCancelDelete, deleting,
}: TemplateCardProps) {
  const triggerLabel = TRIGGER_OPTIONS.find(o => o.value === (t.trigger_type ?? ""))?.label ?? "수동";

  return (
    <div className={cn(
      "rounded-xl border bg-card p-4 shadow-card transition-all",
      t.is_active ? "border-border" : "border-border/50 opacity-60"
    )}>
      <div className="flex items-start gap-3">
        {/* 아이콘 */}
        <div className={cn("rounded-lg p-2 shrink-0", t.is_active ? "bg-primary/10" : "bg-muted")}>
          <MessageSquare className={cn("size-4", t.is_active ? "text-primary" : "text-muted-foreground")} />
        </div>

        {/* 내용 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-foreground">{t.name}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", CHANNEL_COLOR[t.channel])}>
              {t.channel === "sms" ? <Phone className="inline size-2.5 mr-0.5" /> : <MessageSquare className="inline size-2.5 mr-0.5" />}
              {CHANNEL_LABEL[t.channel]}
            </span>
            {t.trigger_type && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                <Layers className="inline size-2.5 mr-0.5" />
                {triggerLabel}
              </span>
            )}
            {!t.is_active && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">비활성</span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap leading-relaxed">
            {t.content}
          </p>
        </div>

        {/* 액션 버튼 */}
        {!confirmingDelete ? (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onToggle}
              disabled={toggling}
              title={t.is_active ? "비활성화" : "활성화"}
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {t.is_active
                ? <ToggleRight className="size-4 text-primary" />
                : <ToggleLeft className="size-4" />}
            </button>
            <button
              onClick={onEdit}
              title="수정"
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Pencil className="size-4" />
            </button>
            <button
              onClick={onDelete}
              title="삭제"
              className="rounded-md p-1.5 text-muted-foreground hover:text-danger hover:bg-danger/5 transition-colors"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <p className="text-xs text-danger font-medium">삭제할까요?</p>
            <Button size="sm" variant="destructive" disabled={deleting} onClick={onConfirmDelete}>
              {deleting ? "…" : "삭제"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelDelete}>취소</Button>
          </div>
        )}
      </div>
    </div>
  );
}

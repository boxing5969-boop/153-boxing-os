import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, ChevronUp, ChevronDown,
  Check, X, ToggleLeft, ToggleRight, ListChecks,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listBranchPlanPresets,
  createBranchPlanPreset,
  updateBranchPlanPreset,
  deactivateBranchPlanPreset,
  reorderBranchPlanPresets,
  type BranchPlanPreset,
} from "@/services/branchPlanPresets";
import { cn } from "@/lib/cn";

interface Props {
  branchId: string;
}

function formatPrice(n: number) {
  return n.toLocaleString("ko-KR") + "원";
}

interface PresetFormState {
  name: string;
  days: string;
  price: string;
  description: string;
}

const EMPTY_FORM: PresetFormState = { name: "", days: "30", price: "", description: "" };

function PresetForm({
  initial,
  onSave,
  onCancel,
  saving,
  error,
}: {
  initial?: PresetFormState;
  onSave: (v: PresetFormState) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState<PresetFormState>(initial ?? EMPTY_FORM);
  const set = (k: keyof PresetFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <Label htmlFor="preset-name" className="text-xs">플랜 이름 <span className="text-danger">*</span></Label>
          <Input
            id="preset-name"
            placeholder="예: 1개월권"
            value={form.name}
            onChange={set("name")}
            required
            autoFocus
            maxLength={50}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="preset-days" className="text-xs">기간 (일) <span className="text-danger">*</span></Label>
          <Input
            id="preset-days"
            type="number"
            min={1}
            max={3650}
            placeholder="30"
            value={form.days}
            onChange={set("days")}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="preset-price" className="text-xs">가격 (원) <span className="text-danger">*</span></Label>
          <Input
            id="preset-price"
            type="number"
            min={0}
            step={1000}
            placeholder="150000"
            value={form.price}
            onChange={set("price")}
            required
          />
        </div>
        <div className="col-span-2 space-y-1">
          <Label htmlFor="preset-desc" className="text-xs">설명 <span className="text-xs text-muted-foreground font-normal">(선택)</span></Label>
          <Input
            id="preset-desc"
            placeholder="예: PT 10회 포함"
            value={form.description}
            onChange={set("description")}
            maxLength={100}
          />
        </div>
      </div>
      {form.price && Number(form.price) > 0 && (
        <p className="text-xs text-primary font-semibold">{formatPrice(Number(form.price))}</p>
      )}
      {error && (
        <p className="text-xs text-danger">{error}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          <X className="size-3.5" /> 취소
        </Button>
        <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
          {saving
            ? <><span className="size-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> 저장 중…</>
            : <><Check className="size-3.5" /> 저장</>
          }
        </Button>
      </div>
    </form>
  );
}

export function BranchPlanPresetsCard({ branchId }: Props) {
  const qc = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const presetsQ = useQuery({
    queryKey: ["branch-plan-presets", branchId, showInactive],
    queryFn: () => listBranchPlanPresets(branchId, showInactive),
    staleTime: 30_000,
  });
  const presets = presetsQ.data ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["branch-plan-presets", branchId] });
    void qc.invalidateQueries({ queryKey: ["branch-plan-presets-active", branchId] });
  };

  const createMutation = useMutation({
    mutationFn: (f: PresetFormState) =>
      createBranchPlanPreset({
        branch_id: branchId,
        name: f.name.trim(),
        days: Number(f.days),
        price: Number(f.price),
        description: f.description.trim() || undefined,
      }),
    onSuccess: () => { invalidate(); setShowAddForm(false); setFormError(null); },
    onError: (e) => setFormError(e instanceof Error ? e.message : "생성 실패"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, f }: { id: string; f: PresetFormState }) =>
      updateBranchPlanPreset(id, {
        name: f.name.trim(),
        days: Number(f.days),
        price: Number(f.price),
        description: f.description?.trim() || null,
      }),
    onSuccess: () => { invalidate(); setEditingId(null); setFormError(null); },
    onError: (e) => setFormError(e instanceof Error ? e.message : "수정 실패"),
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivateBranchPlanPreset,
    onSuccess: () => invalidate(),
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => updateBranchPlanPreset(id, { is_active: true }),
    onSuccess: () => invalidate(),
  });

  const reorderMutation = useMutation({
    mutationFn: reorderBranchPlanPresets,
    onSuccess: () => invalidate(),
  });

  function moveItem(idx: number, dir: -1 | 1) {
    const active = presets.filter((p) => p.is_active);
    const newList = [...active];
    const target = idx + dir;
    if (target < 0 || target >= newList.length) return;
    [newList[idx], newList[target]] = [newList[target]!, newList[idx]!];
    reorderMutation.mutate(newList.map((p) => p.id));
  }

  const activePresets = presets.filter((p) => p.is_active);
  const inactivePresets = presets.filter((p) => !p.is_active);

  function toFormState(p: BranchPlanPreset): PresetFormState {
    return {
      name: p.name,
      days: String(p.days),
      price: String(p.price),
      description: p.description ?? "",
    };
  }

  return (
    <Card>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">이용권 플랜 설정</span>
          <span className="rounded-full bg-primary/10 text-primary text-[11px] font-bold px-2 py-px">
            {activePresets.length}개
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showInactive
              ? <ToggleRight className="size-4 text-primary" />
              : <ToggleLeft className="size-4" />}
            비활성 포함
          </button>
          <Button
            size="sm"
            onClick={() => { setShowAddForm(true); setFormError(null); }}
            disabled={showAddForm}
            className="gap-1.5"
          >
            <Plus className="size-3.5" />
            플랜 추가
          </Button>
        </div>
      </div>

      <CardContent className="p-4 space-y-3">
        {presetsQ.isLoading && (
          <div className="space-y-2">
            {[0,1,2].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        )}

        {!presetsQ.isLoading && activePresets.length === 0 && !showAddForm && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ListChecks className="size-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">등록된 플랜이 없습니다</p>
            <Button size="sm" variant="outline" onClick={() => setShowAddForm(true)} className="gap-1.5">
              <Plus className="size-3.5" />
              첫 플랜 추가
            </Button>
          </div>
        )}

        {/* 새 플랜 추가 폼 */}
        {showAddForm && (
          <PresetForm
            onSave={(f) => createMutation.mutate(f)}
            onCancel={() => { setShowAddForm(false); setFormError(null); }}
            saving={createMutation.isPending}
            error={formError}
          />
        )}

        {/* 활성 플랜 목록 */}
        {activePresets.map((preset, idx) => (
          <div key={preset.id}>
            {editingId === preset.id ? (
              <PresetForm
                initial={toFormState(preset)}
                onSave={(f) => updateMutation.mutate({ id: preset.id, f })}
                onCancel={() => { setEditingId(null); setFormError(null); }}
                saving={updateMutation.isPending}
                error={formError}
              />
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                {/* 순서 변경 버튼 */}
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveItem(idx, -1)}
                    disabled={idx === 0 || reorderMutation.isPending}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                    title="위로"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(idx, 1)}
                    disabled={idx === activePresets.length - 1 || reorderMutation.isPending}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                    title="아래로"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </div>

                {/* 플랜 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">{preset.name}</span>
                    <span className="text-xs text-muted-foreground">{preset.days}일</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-sm font-bold text-primary">{formatPrice(Number(preset.price))}</span>
                    {preset.description && (
                      <span className="text-xs text-muted-foreground truncate">{preset.description}</span>
                    )}
                  </div>
                </div>

                {/* 액션 버튼 */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => { setEditingId(preset.id); setFormError(null); }}
                    className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="수정"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`"${preset.name}" 플랜을 비활성화할까요? 기존 이용권에는 영향 없습니다.`)) {
                        deactivateMutation.mutate(preset.id);
                      }
                    }}
                    disabled={deactivateMutation.isPending}
                    className="rounded-lg p-1.5 text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors"
                    title="비활성화"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* 비활성 플랜 목록 */}
        {showInactive && inactivePresets.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-semibold px-1 mt-4">비활성 플랜</p>
            {inactivePresets.map((preset) => (
              <div
                key={preset.id}
                className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 opacity-60"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-muted-foreground line-through">{preset.name}</span>
                    <span className="text-xs text-muted-foreground">{preset.days}일</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatPrice(Number(preset.price))}</span>
                </div>
                <button
                  type="button"
                  onClick={() => activateMutation.mutate(preset.id)}
                  disabled={activateMutation.isPending}
                  className="rounded-lg px-2.5 py-1 text-xs font-semibold text-primary border border-primary/30 hover:bg-primary/10 transition-colors"
                >
                  활성화
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

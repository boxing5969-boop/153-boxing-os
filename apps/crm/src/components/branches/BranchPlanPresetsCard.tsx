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
  PLAN_TYPE_LABELS,
  PLAN_TYPE_COLORS,
  type BranchPlanPreset,
  type PlanType,
} from "@/services/branchPlanPresets";
import { cn } from "@/lib/cn";

interface Props { branchId: string; }

function formatPrice(n: number) { return n.toLocaleString("ko-KR") + "원"; }

const PLAN_TYPES: PlanType[] = ["period", "session", "pt", "class"];

interface PresetFormState {
  name: string;
  plan_type: PlanType;
  days: string;
  price: string;
  max_sessions: string;
  description: string;
}

const EMPTY_FORM: PresetFormState = {
  name: "", plan_type: "period", days: "30", price: "", max_sessions: "", description: "",
};

function PresetForm({
  initial, onSave, onCancel, saving, error,
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
  const isSession = form.plan_type === "session";

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}
      className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">

      {/* 플랜 유형 선택 */}
      <div className="space-y-1">
        <Label className="text-xs">플랜 유형 <span className="text-danger">*</span></Label>
        <div className="grid grid-cols-4 gap-1.5">
          {PLAN_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setForm((p) => ({ ...p, plan_type: t }))}
              className={cn(
                "rounded-lg border px-2 py-1.5 text-xs font-semibold transition-all",
                form.plan_type === t
                  ? PLAN_TYPE_COLORS[t]
                  : "border-border bg-card text-muted-foreground hover:border-primary/40"
              )}
            >
              {PLAN_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <Label htmlFor="preset-name" className="text-xs">
            플랜 이름 <span className="text-danger">*</span>
          </Label>
          <Input
            id="preset-name"
            placeholder={
              form.plan_type === "session" ? "예: 헬스 30회권" :
              form.plan_type === "pt" ? "예: PT 10회권" :
              form.plan_type === "class" ? "예: 복싱 수강권 1개월" :
              "예: 1개월권"
            }
            value={form.name}
            onChange={set("name")}
            required
            autoFocus
            maxLength={50}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="preset-days" className="text-xs">
            기간 (일) <span className="text-danger">*</span>
          </Label>
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

        {isSession ? (
          <div className="space-y-1">
            <Label htmlFor="preset-sessions" className="text-xs">
              총 횟수 <span className="text-danger">*</span>
            </Label>
            <Input
              id="preset-sessions"
              type="number"
              min={1}
              placeholder="30"
              value={form.max_sessions}
              onChange={set("max_sessions")}
              required={isSession}
            />
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="preset-price" className="text-xs">
              가격 (원) <span className="text-danger">*</span>
            </Label>
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
        )}

        {isSession && (
          <div className="space-y-1">
            <Label htmlFor="preset-price-s" className="text-xs">
              가격 (원) <span className="text-danger">*</span>
            </Label>
            <Input
              id="preset-price-s"
              type="number"
              min={0}
              step={1000}
              placeholder="300000"
              value={form.price}
              onChange={set("price")}
              required
            />
          </div>
        )}

        <div className={cn("space-y-1", isSession ? "col-span-2" : "col-span-2")}>
          <Label htmlFor="preset-desc" className="text-xs">
            설명 <span className="text-xs text-muted-foreground font-normal">(선택)</span>
          </Label>
          <Input
            id="preset-desc"
            placeholder="예: 주 3회 이용 권장"
            value={form.description}
            onChange={set("description")}
            maxLength={100}
          />
        </div>
      </div>

      {form.price && Number(form.price) > 0 && (
        <p className="text-xs text-primary font-semibold">{formatPrice(Number(form.price))}</p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          <X className="size-3.5" /> 취소
        </Button>
        <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
          {saving
            ? <><span className="size-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> 저장 중…</>
            : <><Check className="size-3.5" /> 저장</>}
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
  const [filterType, setFilterType] = useState<PlanType | "all">("all");
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
        branch_id:    branchId,
        name:         f.name.trim(),
        plan_type:    f.plan_type,
        days:         Number(f.days),
        price:        Number(f.price),
        description:  f.description.trim() || undefined,
        max_sessions: f.plan_type === "session" && f.max_sessions ? Number(f.max_sessions) : null,
      }),
    onSuccess: () => { invalidate(); setShowAddForm(false); setFormError(null); },
    onError: (e) => setFormError(e instanceof Error ? e.message : "생성 실패"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, f }: { id: string; f: PresetFormState }) =>
      updateBranchPlanPreset(id, {
        name:         f.name.trim(),
        plan_type:    f.plan_type,
        days:         Number(f.days),
        price:        Number(f.price),
        description:  f.description?.trim() || null,
        max_sessions: f.plan_type === "session" && f.max_sessions ? Number(f.max_sessions) : null,
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

  function moveItem(idx: number, dir: -1 | 1, list: BranchPlanPreset[]) {
    const newList = [...list];
    const target = idx + dir;
    if (target < 0 || target >= newList.length) return;
    [newList[idx], newList[target]] = [newList[target]!, newList[idx]!];
    reorderMutation.mutate(newList.map((p) => p.id));
  }

  function toFormState(p: BranchPlanPreset): PresetFormState {
    return {
      name:         p.name,
      plan_type:    p.plan_type,
      days:         String(p.days),
      price:        String(p.price),
      max_sessions: p.max_sessions ? String(p.max_sessions) : "",
      description:  p.description ?? "",
    };
  }

  const activePresets = presets.filter((p) => p.is_active);
  const inactivePresets = presets.filter((p) => !p.is_active);
  const filteredActive = filterType === "all"
    ? activePresets
    : activePresets.filter((p) => p.plan_type === filterType);

  // 카테고리별 개수
  const countByType = Object.fromEntries(
    PLAN_TYPES.map((t) => [t, activePresets.filter((p) => p.plan_type === t).length])
  ) as Record<PlanType, number>;

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
            {showInactive ? <ToggleRight className="size-4 text-primary" /> : <ToggleLeft className="size-4" />}
            비활성
          </button>
          <Button size="sm" onClick={() => { setShowAddForm(true); setFormError(null); }} disabled={showAddForm} className="gap-1.5">
            <Plus className="size-3.5" /> 플랜 추가
          </Button>
        </div>
      </div>

      {/* 카테고리 탭 필터 */}
      <div className="flex gap-1.5 px-5 pt-3 pb-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => setFilterType("all")}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold border transition-all shrink-0",
            filterType === "all"
              ? "bg-foreground text-background border-foreground"
              : "border-border text-muted-foreground hover:border-primary/40"
          )}
        >
          전체 {activePresets.length}
        </button>
        {PLAN_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilterType(t)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold border transition-all shrink-0",
              filterType === t
                ? PLAN_TYPE_COLORS[t]
                : "border-border text-muted-foreground hover:border-primary/40"
            )}
          >
            {PLAN_TYPE_LABELS[t]} {countByType[t] > 0 && countByType[t]}
          </button>
        ))}
      </div>

      <CardContent className="p-4 space-y-2">
        {presetsQ.isLoading && (
          <div className="space-y-2">
            {[0,1,2].map((i) => <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />)}
          </div>
        )}

        {!presetsQ.isLoading && filteredActive.length === 0 && !showAddForm && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ListChecks className="size-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {filterType === "all" ? "등록된 플랜이 없습니다" : `${PLAN_TYPE_LABELS[filterType]} 플랜이 없습니다`}
            </p>
            <Button size="sm" variant="outline" onClick={() => setShowAddForm(true)} className="gap-1.5">
              <Plus className="size-3.5" /> 추가
            </Button>
          </div>
        )}

        {showAddForm && (
          <PresetForm
            onSave={(f) => createMutation.mutate(f)}
            onCancel={() => { setShowAddForm(false); setFormError(null); }}
            saving={createMutation.isPending}
            error={formError}
          />
        )}

        {filteredActive.map((preset, idx) => (
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
              <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3">
                {/* 순서 버튼 */}
                <div className="flex flex-col gap-0.5">
                  <button type="button" onClick={() => moveItem(idx, -1, filteredActive)}
                    disabled={idx === 0 || reorderMutation.isPending}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => moveItem(idx, 1, filteredActive)}
                    disabled={idx === filteredActive.length - 1 || reorderMutation.isPending}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors">
                    <ChevronDown className="size-3.5" />
                  </button>
                </div>

                {/* 플랜 유형 뱃지 */}
                <span className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-bold shrink-0",
                  PLAN_TYPE_COLORS[preset.plan_type]
                )}>
                  {PLAN_TYPE_LABELS[preset.plan_type]}
                </span>

                {/* 플랜 정보 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground">{preset.name}</span>
                    <span className="text-xs text-muted-foreground">{preset.days}일</span>
                    {preset.max_sessions && (
                      <span className="text-xs text-success font-semibold">{preset.max_sessions}회</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-sm font-bold text-primary">{formatPrice(Number(preset.price))}</span>
                    {preset.max_sessions && (
                      <span className="text-xs text-muted-foreground">
                        회당 {formatPrice(Math.round(Number(preset.price) / preset.max_sessions))}
                      </span>
                    )}
                    {preset.description && (
                      <span className="text-xs text-muted-foreground truncate">{preset.description}</span>
                    )}
                  </div>
                </div>

                {/* 액션 */}
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => { setEditingId(preset.id); setFormError(null); }}
                    className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <Pencil className="size-3.5" />
                  </button>
                  <button type="button"
                    onClick={() => { if (confirm(`"${preset.name}" 플랜을 비활성화할까요?`)) deactivateMutation.mutate(preset.id); }}
                    disabled={deactivateMutation.isPending}
                    className="rounded-lg p-1.5 text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* 비활성 플랜 */}
        {showInactive && inactivePresets.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground font-semibold px-1">비활성 플랜</p>
            {inactivePresets.map((preset) => (
              <div key={preset.id}
                className="flex items-center gap-2.5 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 opacity-60">
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold shrink-0", PLAN_TYPE_COLORS[preset.plan_type])}>
                  {PLAN_TYPE_LABELS[preset.plan_type]}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm text-muted-foreground line-through">{preset.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{preset.days}일 · {formatPrice(Number(preset.price))}</span>
                </div>
                <button type="button" onClick={() => activateMutation.mutate(preset.id)}
                  disabled={activateMutation.isPending}
                  className="rounded-lg px-2.5 py-1 text-xs font-semibold text-primary border border-primary/30 hover:bg-primary/10 transition-colors">
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

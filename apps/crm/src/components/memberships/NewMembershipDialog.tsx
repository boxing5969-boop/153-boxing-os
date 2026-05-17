import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createMembership } from "@/services/memberships";
import {
  listBranchPlanPresets,
  PLAN_TYPE_LABELS,
  PLAN_TYPE_COLORS,
  type BranchPlanPreset,
  type PlanType,
} from "@/services/branchPlanPresets";
import { cn } from "@/lib/cn";
import type { Member, Membership, PaymentStatus } from "@153/shared";

interface Props {
  open: boolean;
  onClose: () => void;
  member: Member;
  /** 연장 모드: 기존 활성 이용권을 전달하면 연장 탭이 기본 선택됨 */
  activeMembership?: Membership | null;
}

type TabMode = "new" | "extend";

const ALL_PLAN_TYPES: PlanType[] = ["period", "session", "pt", "class"];

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDays(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function formatPrice(n: number) {
  return n.toLocaleString("ko-KR") + "원";
}

const PAYMENT_OPTIONS: { value: PaymentStatus; label: string; color: string }[] = [
  { value: "paid",    label: "결제완료", color: "border-success bg-success/10 text-success" },
  { value: "partial", label: "부분결제", color: "border-warning bg-warning/10 text-warning" },
  { value: "unpaid",  label: "미납",     color: "border-danger bg-danger/10 text-danger" },
];

/** 횟수권 계열 plan_type은 max_sessions 필드를 보여줌 */
function isSessionBased(planType?: PlanType | null) {
  return planType === "session" || planType === "pt" || planType === "class";
}

export function NewMembershipDialog({ open, onClose, member, activeMembership }: Props) {
  const qc = useQueryClient();

  // ── 탭 모드 (신규 / 연장)
  const canExtend = !!activeMembership && activeMembership.status === "active";
  const [tabMode, setTabMode] = useState<TabMode>(canExtend ? "extend" : "new");

  // ── 카테고리 필터
  const [categoryFilter, setCategoryFilter] = useState<PlanType | "all">("all");

  // ── 플랜 선택
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customPlanType, setCustomPlanType] = useState<PlanType>("period");

  // ── 기간/세션/가격
  const [days, setDays] = useState(30);
  const [price, setPrice] = useState(0);
  const [maxSessions, setMaxSessions] = useState<number | "">(10);

  // ── 날짜
  const [startDate, setStartDate] = useState(todayIso());
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [error, setError] = useState<string | null>(null);

  // ── 지점 플랜 프리셋 로드
  const presetsQ = useQuery({
    queryKey: ["branch-plan-presets-active", member.branch_id],
    queryFn: () => listBranchPlanPresets(member.branch_id, false),
    staleTime: 60_000,
    enabled: open,
  });
  const allPresets = presetsQ.data ?? [];

  // ── 카테고리 필터링
  const presets = useMemo<BranchPlanPreset[]>(() => {
    if (categoryFilter === "all") return allPresets;
    return allPresets.filter((p) => p.plan_type === categoryFilter);
  }, [allPresets, categoryFilter]);

  // ── 선택된 프리셋
  const selectedPreset = selectedPresetId ? allPresets.find((p) => p.id === selectedPresetId) : null;
  const activePlanType: PlanType | null = isCustom ? customPlanType : (selectedPreset?.plan_type ?? null);

  // ── 연장 시작일 계산
  const extendStartDate = useMemo(() => {
    if (tabMode === "extend" && activeMembership?.end_date) {
      return addDays(activeMembership.end_date, 1);
    }
    return todayIso();
  }, [tabMode, activeMembership?.end_date]);

  const endDate = useMemo(() => addDays(startDate, days), [startDate, days]);
  const planName = isCustom ? customName : (selectedPreset?.name ?? "");

  // ── 다이얼로그 열릴 때 초기화
  useEffect(() => {
    if (!open) return;
    const mode = canExtend ? "extend" : "new";
    setTabMode(mode);
    setCategoryFilter("all");
    setSelectedPresetId(null);
    setIsCustom(false);
    setCustomName("");
    setCustomPlanType("period");
    setDays(30);
    setPrice(0);
    setMaxSessions(10);
    setStartDate(mode === "extend" && activeMembership?.end_date
      ? addDays(activeMembership.end_date, 1)
      : todayIso()
    );
    setPaymentStatus("paid");
    setError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 탭 변경 시 시작일 업데이트
  useEffect(() => {
    if (tabMode === "extend" && activeMembership?.end_date) {
      setStartDate(addDays(activeMembership.end_date, 1));
    } else {
      setStartDate(todayIso());
    }
  }, [tabMode, activeMembership?.end_date]);

  // ── 프리셋 로드 완료 시 첫 번째 자동 선택
  useEffect(() => {
    if (open && presets.length > 0 && !selectedPresetId && !isCustom) {
      applyPreset(presets[0]!);
    }
  }, [open, presets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 카테고리 변경 시 첫 번째 프리셋 선택
  useEffect(() => {
    if (presets.length > 0) {
      applyPreset(presets[0]!);
      setIsCustom(false);
    } else if (categoryFilter !== "all") {
      setSelectedPresetId(null);
    }
  }, [categoryFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyPreset(p: BranchPlanPreset) {
    setSelectedPresetId(p.id);
    setIsCustom(false);
    setDays(p.days);
    setPrice(Number(p.price));
    if (p.max_sessions != null) setMaxSessions(p.max_sessions);
  }

  function handlePresetSelect(p: BranchPlanPreset) {
    applyPreset(p);
  }

  function handleCustomSelect() {
    setIsCustom(true);
    setSelectedPresetId(null);
  }

  const mutation = useMutation({
    mutationFn: createMembership,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["memberships"] });
      void qc.invalidateQueries({ queryKey: ["member-related", member.id] });
      void qc.invalidateQueries({ queryKey: ["access-preview", member.id] });
      void qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "등록 실패"),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!planName.trim()) { setError("플랜 이름을 입력하세요"); return; }
    if (days < 1) { setError("기간은 1일 이상이어야 합니다"); return; }

    const resolvedMaxSessions = isSessionBased(activePlanType)
      ? (maxSessions === "" ? null : Number(maxSessions))
      : null;

    mutation.mutate({
      member_id: member.id,
      branch_id: member.branch_id,
      plan_name: planName.trim(),
      plan_type: activePlanType ?? undefined,
      start_date: startDate,
      end_date: endDate,
      payment_status: paymentStatus,
      price: price > 0 ? price : null,
      max_sessions: resolvedMaxSessions,
    });
  }

  const dialogTitle = tabMode === "extend" ? "이용권 연장" : "이용권 등록";

  return (
    <Dialog open={open} onClose={onClose} title={dialogTitle}>
      <form onSubmit={handleSubmit} className="space-y-5">

        {/* 회원 정보 */}
        <div className="flex items-center gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5">
          <div className="flex size-7 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
            {member.name[0]}
          </div>
          <span className="text-sm font-semibold text-foreground">{member.name}</span>
          {tabMode === "extend" && activeMembership && (
            <span className="ml-auto text-xs text-muted-foreground">
              현재 종료: <span className="font-semibold text-foreground">{activeMembership.end_date}</span>
            </span>
          )}
        </div>

        {/* 신규 / 연장 탭 */}
        {canExtend && (
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["extend", "new"] as TabMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTabMode(mode)}
                className={cn(
                  "flex-1 py-2 text-sm font-semibold transition-colors",
                  tabMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-muted/60"
                )}
              >
                {mode === "extend" ? "연장" : "신규 등록"}
              </button>
            ))}
          </div>
        )}

        {/* 연장 모드 안내 */}
        {tabMode === "extend" && activeMembership && (
          <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-sm text-primary">
            <svg className="size-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
            </svg>
            <span>연장 시작일이 <strong>{extendStartDate}</strong>로 자동 설정됩니다.</span>
          </div>
        )}

        {/* 카테고리 탭 필터 */}
        {allPresets.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            <button
              type="button"
              onClick={() => setCategoryFilter("all")}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                categoryFilter === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40"
              )}
            >
              전체
            </button>
            {ALL_PLAN_TYPES.map((type) => {
              const has = allPresets.some((p) => p.plan_type === type);
              if (!has) return null;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setCategoryFilter(type)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                    categoryFilter === type
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/40"
                  )}
                >
                  {PLAN_TYPE_LABELS[type]}
                </button>
              );
            })}
          </div>
        )}

        {/* 플랜 카드 목록 */}
        <div>
          <Label className="mb-2 block">플랜 선택</Label>

          {presetsQ.isLoading && (
            <div className="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[72px] rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          )}

          {!presetsQ.isLoading && allPresets.length === 0 && (
            <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
              등록된 플랜이 없습니다.{" "}
              <span className="text-primary font-semibold">지점 설정</span>에서 플랜을 추가하세요.
            </div>
          )}

          {!presetsQ.isLoading && allPresets.length > 0 && presets.length === 0 && (
            <div className="rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground">
              이 카테고리에 플랜이 없습니다.
            </div>
          )}

          {!presetsQ.isLoading && presets.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {presets.map((p) => {
                const isSelected = !isCustom && selectedPresetId === p.id;
                const typeColor = PLAN_TYPE_COLORS[p.plan_type];
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handlePresetSelect(p)}
                    className={cn(
                      "relative flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition-all",
                      isSelected
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border bg-card hover:border-primary/40"
                    )}
                  >
                    {/* 플랜 타입 뱃지 */}
                    <span className={cn(
                      "mb-0.5 inline-block rounded-full border px-1.5 py-[1px] text-[10px] font-semibold",
                      typeColor
                    )}>
                      {PLAN_TYPE_LABELS[p.plan_type]}
                    </span>
                    <span className="text-sm font-semibold text-foreground leading-tight">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.days}일
                      {p.max_sessions != null && ` · ${p.max_sessions}회`}
                    </span>
                    <span className="mt-0.5 text-sm font-bold text-primary">{formatPrice(Number(p.price))}</span>
                    {p.description && (
                      <span className="text-[11px] text-muted-foreground truncate w-full">{p.description}</span>
                    )}
                    {/* 회당 가격 */}
                    {p.max_sessions != null && p.max_sessions > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        회당 {formatPrice(Math.round(Number(p.price) / p.max_sessions))}
                      </span>
                    )}
                    {isSelected && (
                      <div className="absolute right-2 top-2 size-4 rounded-full bg-primary flex items-center justify-center">
                        <svg className="size-2.5 text-white" viewBox="0 0 12 12" fill="currentColor">
                          <path d="M10 3L5 8.5 2 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* 직접 입력 */}
          <button
            type="button"
            onClick={handleCustomSelect}
            className={cn(
              "mt-2 w-full rounded-xl border px-3 py-2.5 text-left text-sm transition-all",
              isCustom
                ? "border-primary bg-primary/5"
                : "border-dashed border-border text-muted-foreground hover:border-primary/40"
            )}
          >
            {isCustom ? (
              <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                <Input
                  autoFocus
                  placeholder="플랜 이름 직접 입력"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="border-0 p-0 h-auto bg-transparent focus:ring-0 text-sm font-medium"
                />
                {/* 커스텀 플랜 타입 선택 */}
                <div className="flex gap-1 pt-1">
                  {ALL_PLAN_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setCustomPlanType(type); }}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-all",
                        customPlanType === type
                          ? PLAN_TYPE_COLORS[type]
                          : "border-border text-muted-foreground"
                      )}
                    >
                      {PLAN_TYPE_LABELS[type]}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              "+ 직접 입력"
            )}
          </button>
        </div>

        {/* 횟수권 계열: max_sessions */}
        {isSessionBased(activePlanType) && (
          <div className="space-y-1.5">
            <Label htmlFor="maxSessions">
              {activePlanType === "pt" ? "PT 횟수" : activePlanType === "class" ? "수강 횟수" : "총 횟수"}
            </Label>
            <div className="relative">
              <Input
                id="maxSessions"
                type="number"
                min={1}
                max={9999}
                value={maxSessions}
                onChange={(e) => {
                  const v = e.target.value;
                  setMaxSessions(v === "" ? "" : Number(v));
                }}
                className="pr-8"
                placeholder="예: 10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">회</span>
            </div>
            {price > 0 && maxSessions !== "" && Number(maxSessions) > 0 && (
              <p className="text-xs text-muted-foreground">
                회당 <span className="font-semibold text-foreground">{formatPrice(Math.round(price / Number(maxSessions)))}</span>
              </p>
            )}
          </div>
        )}

        {/* 기간 설정 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="start">시작일</Label>
            <Input
              id="start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              min={tabMode === "extend" ? extendStartDate : undefined}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="days">기간 (일)</Label>
            <Input
              id="days"
              type="number"
              min={1}
              max={730}
              value={days}
              onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setDays(v); }}
              required
            />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm">
          <span className="text-muted-foreground">종료일</span>
          <span className="font-semibold text-foreground tabular">{endDate}</span>
        </div>

        {/* 가격 */}
        <div className="space-y-1.5">
          <Label htmlFor="price">가격 (원)</Label>
          <div className="relative">
            <Input
              id="price"
              type="number"
              min={0}
              step={10000}
              value={price}
              onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setPrice(v); }}
              className="pr-8"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
          </div>
          {price > 0 && (
            <p className="text-xs text-primary font-medium">{formatPrice(price)}</p>
          )}
        </div>

        {/* 결제 상태 */}
        <div className="space-y-1.5">
          <Label>결제 상태</Label>
          <div className="flex gap-2">
            {PAYMENT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPaymentStatus(opt.value)}
                className={cn(
                  "flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-all",
                  paymentStatus === opt.value
                    ? opt.color
                    : "border-border bg-card text-muted-foreground hover:border-primary/40"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5">
            <div className="size-1.5 rounded-full bg-danger shrink-0" />
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={mutation.isPending} className="gap-2 px-6">
            {mutation.isPending ? (
              <>
                <span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                {tabMode === "extend" ? "연장 중…" : "등록 중…"}
              </>
            ) : tabMode === "extend" ? "이용권 연장" : "이용권 등록"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

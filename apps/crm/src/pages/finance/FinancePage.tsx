import { useState, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, Plus, Pencil, Trash2,
  TrendingUp, TrendingDown, Minus, RotateCcw, Check, X,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import {
  getMonthExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
  type BranchExpense,
  type ExpenseCategory,
} from "@/services/expenses";
import { getRevenueSummary } from "@/services/finance";
import { cn } from "@/lib/cn";

// ── 날짜 헬퍼 ──────────────────────────────────────────────────────────
function nowYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function addMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function labelYearMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}년 ${m}월`;
}
function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y!, m!, 0);
  const to = `${y}-${String(m).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  return { from: `${ym}-01`, to };
}
function formatKrw(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}

// ── 인라인 금액 편집 컴포넌트 ─────────────────────────────────────────
function InlineAmount({
  value,
  onSave,
}: {
  value: number;
  onSave: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(String(value));
    setEditing(true);
    setTimeout(() => ref.current?.select(), 0);
  }
  function commit() {
    const v = Number(draft.replace(/[^0-9]/g, ""));
    if (!Number.isNaN(v) && v >= 0) onSave(v);
    setEditing(false);
  }
  function cancel() { setEditing(false); }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
          className="w-32 h-8 text-right tabular text-sm"
          autoFocus
        />
        <button onClick={commit} className="text-success hover:text-success/80">
          <Check className="size-4" />
        </button>
        <button onClick={cancel} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={startEdit}
      className="tabular text-sm font-semibold text-foreground hover:text-primary hover:underline transition-colors"
      title="클릭해서 수정"
    >
      {formatKrw(value)}
    </button>
  );
}

// ── 지출 항목 행 ──────────────────────────────────────────────────────
function ExpenseRow({
  item,
  onAmountChange,
  onNameChange,
  onDelete,
  onToggleRecurring,
}: {
  item: BranchExpense;
  onAmountChange: (id: string, v: number) => void;
  onNameChange: (id: string, v: string) => void;
  onDelete: (id: string) => void;
  onToggleRecurring: (id: string, v: boolean) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(item.name);

  function commitName() {
    if (nameDraft.trim()) onNameChange(item.id, nameDraft.trim());
    setEditingName(false);
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 group hover:border-primary/20 transition-colors">
      {/* 이름 */}
      <div className="flex-1 min-w-0">
        {editingName ? (
          <Input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") { setNameDraft(item.name); setEditingName(false); } }}
            onBlur={commitName}
            className="h-7 text-sm"
          />
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setNameDraft(item.name); setEditingName(true); }}
              className="text-sm font-medium text-foreground hover:text-primary transition-colors text-left"
              title="클릭해서 이름 수정"
            >
              {item.name}
            </button>
            {item.is_recurring && (
              <span className="text-[10px] rounded-full bg-primary/10 text-primary px-1.5 py-px font-semibold">
                매달
              </span>
            )}
          </div>
        )}
      </div>

      {/* 금액 (인라인 편집) */}
      <InlineAmount
        value={Number(item.amount)}
        onSave={(v) => onAmountChange(item.id, v)}
      />

      {/* 액션 버튼 (hover 시 표시) */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onToggleRecurring(item.id, !item.is_recurring)}
          title={item.is_recurring ? "매달 반복 해제" : "매달 반복 설정"}
          className={cn(
            "rounded-md p-1.5 transition-colors",
            item.is_recurring
              ? "text-primary hover:bg-primary/10"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          <RotateCcw className="size-3.5" />
        </button>
        <button
          onClick={() => { if (confirm(`"${item.name}" 항목을 삭제할까요?`)) onDelete(item.id); }}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-danger/10 hover:text-danger transition-colors"
          title="삭제"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── 지출 추가 폼 ──────────────────────────────────────────────────────
function AddExpenseRow({
  category,
  branchId,
  yearMonth,
  onAdd,
  onCancel,
}: {
  category: ExpenseCategory;
  branchId: string;
  yearMonth: string;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [recurring, setRecurring] = useState(category === "fixed");
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => addExpense({
      branch_id: branchId,
      year_month: yearMonth,
      category,
      name,
      amount: Number(amount.replace(/[^0-9]/g, "")),
      is_recurring: recurring,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["month-expenses", branchId, yearMonth] });
      onAdd();
    },
  });

  return (
    <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
      <Input
        autoFocus
        placeholder="항목명 (예: 월세)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 h-8 text-sm"
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
      />
      <Input
        placeholder="금액"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-32 h-8 text-right text-sm tabular"
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) mutation.mutate(); if (e.key === "Escape") onCancel(); }}
      />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0">
        <input
          type="checkbox"
          checked={recurring}
          onChange={(e) => setRecurring(e.target.checked)}
          className="accent-primary"
        />
        매달
      </label>
      <Button
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={!name.trim() || mutation.isPending}
        className="h-8 px-3"
      >
        {mutation.isPending ? "추가 중…" : "추가"}
      </Button>
      <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
        <X className="size-4" />
      </button>
    </div>
  );
}

// ── 지출 섹션 ─────────────────────────────────────────────────────────
function ExpenseSection({
  title,
  emoji,
  category,
  items,
  branchId,
  yearMonth,
  onAmountChange,
  onNameChange,
  onDelete,
  onToggleRecurring,
}: {
  title: string;
  emoji: string;
  category: ExpenseCategory;
  items: BranchExpense[];
  branchId: string;
  yearMonth: string;
  onAmountChange: (id: string, v: number) => void;
  onNameChange: (id: string, v: string) => void;
  onDelete: (id: string) => void;
  onToggleRecurring: (id: string, v: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const total = items.reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div className="space-y-3">
      {/* 섹션 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{emoji}</span>
          <div>
            <h3 className="text-sm font-bold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">
              {category === "fixed" ? "매달 고정으로 나가는 돈" : "이번달에 쓴 돈"}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">합계</p>
          <p className="text-lg font-black text-foreground tabular">{formatKrw(total)}</p>
        </div>
      </div>

      {/* 항목 목록 */}
      <div className="space-y-2">
        {items.length === 0 && !adding && (
          <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center">
            <p className="text-sm text-muted-foreground">아직 항목이 없습니다</p>
            <p className="text-xs text-muted-foreground mt-0.5">아래 + 버튼을 눌러 추가하세요</p>
          </div>
        )}
        {items.map((item) => (
          <ExpenseRow
            key={item.id}
            item={item}
            onAmountChange={onAmountChange}
            onNameChange={onNameChange}
            onDelete={onDelete}
            onToggleRecurring={onToggleRecurring}
          />
        ))}

        {adding && (
          <AddExpenseRow
            category={category}
            branchId={branchId}
            yearMonth={yearMonth}
            onAdd={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        )}
      </div>

      {/* 추가 버튼 */}
      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
        >
          <Plus className="size-4" />
          {title} 항목 추가
        </button>
      )}
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────
export default function FinancePage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [yearMonth, setYearMonth] = useState(nowYearMonth());
  const branchId = profile?.branch_id ?? "";

  // ── 매출 조회 (이용권 결제 기준)
  const { from, to } = monthRange(yearMonth);
  const revenueQ = useQuery({
    queryKey: ["finance-revenue", yearMonth, branchId],
    queryFn: () => getRevenueSummary(from, to, branchId || null),
    enabled: !!branchId,
    staleTime: 60_000,
  });

  // ── 지출 조회
  const expensesQ = useQuery({
    queryKey: ["month-expenses", branchId, yearMonth],
    queryFn: () => getMonthExpenses(branchId, yearMonth),
    enabled: !!branchId,
    staleTime: 30_000,
  });

  const expenses = expensesQ.data ?? [];
  const fixed    = expenses.filter((e) => e.category === "fixed");
  const variable = expenses.filter((e) => e.category === "variable");

  const revenue     = (revenueQ.data?.paid_total ?? 0) + (revenueQ.data?.partial_total ?? 0);
  const totalFixed  = fixed.reduce((s, i) => s + Number(i.amount), 0);
  const totalVar    = variable.reduce((s, i) => s + Number(i.amount), 0);
  const totalExp    = totalFixed + totalVar;
  const profit      = revenue - totalExp;
  const isProfit    = profit >= 0;

  // ── 수정 뮤테이션
  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateExpense>[1] }) =>
      updateExpense(id, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["month-expenses", branchId, yearMonth] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteExpense,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["month-expenses", branchId, yearMonth] }),
  });

  function handleAmountChange(id: string, v: number) {
    updateMutation.mutate({ id, patch: { amount: v } });
  }
  function handleNameChange(id: string, v: string) {
    updateMutation.mutate({ id, patch: { name: v } });
  }
  function handleDelete(id: string) {
    deleteMutation.mutate(id);
  }
  function handleToggleRecurring(id: string, v: boolean) {
    updateMutation.mutate({ id, patch: { is_recurring: v } });
  }

  const isLoading = expensesQ.isLoading || revenueQ.isLoading;

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="수익 / 지출"
        description="이번달 매출과 지출을 한눈에 확인하세요"
      />

      {/* ── 월 선택기 ── */}
      <div className="flex items-center justify-center gap-4 rounded-2xl border border-border bg-card px-6 py-3">
        <button
          onClick={() => setYearMonth((m) => addMonth(m, -1))}
          className="rounded-full p-2 hover:bg-muted transition-colors"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="text-center min-w-[120px]">
          <p className="text-xl font-black text-foreground">{labelYearMonth(yearMonth)}</p>
          {yearMonth === nowYearMonth() && (
            <p className="text-xs text-primary font-semibold">이번달</p>
          )}
        </div>
        <button
          onClick={() => setYearMonth((m) => addMonth(m, 1))}
          className="rounded-full p-2 hover:bg-muted transition-colors"
          disabled={yearMonth >= nowYearMonth()}
        >
          <ChevronRight className={cn("size-5", yearMonth >= nowYearMonth() && "opacity-30")} />
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* ── 매출 카드 ── */}
          <div className="rounded-2xl border border-success/20 bg-success/5 px-6 py-5">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-2xl">📈</span>
              <p className="text-sm font-semibold text-muted-foreground">이번달 매출 (이용권 결제)</p>
            </div>
            <p className="text-4xl font-black text-success tabular pl-10">
              {formatKrw(revenue)}
            </p>
            <p className="text-xs text-muted-foreground pl-10 mt-1">
              결제완료 {revenueQ.data?.paid_count ?? 0}건 + 부분결제 {revenueQ.data?.partial_count ?? 0}건
            </p>
          </div>

          {/* ── 구분선 ── */}
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="flex-1 h-px bg-border" />
            <p className="text-xs font-semibold uppercase tracking-widest">지출</p>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* ── 고정 지출 ── */}
          <ExpenseSection
            title="고정 지출"
            emoji="📌"
            category="fixed"
            items={fixed}
            branchId={branchId}
            yearMonth={yearMonth}
            onAmountChange={handleAmountChange}
            onNameChange={handleNameChange}
            onDelete={handleDelete}
            onToggleRecurring={handleToggleRecurring}
          />

          {/* ── 유동 지출 ── */}
          <ExpenseSection
            title="유동 지출"
            emoji="🔄"
            category="variable"
            items={variable}
            branchId={branchId}
            yearMonth={yearMonth}
            onAmountChange={handleAmountChange}
            onNameChange={handleNameChange}
            onDelete={handleDelete}
            onToggleRecurring={handleToggleRecurring}
          />

          {/* ── 순이익 카드 ── */}
          <div className={cn(
            "rounded-2xl border px-6 py-5",
            isProfit
              ? "border-success/20 bg-success/5"
              : "border-danger/20 bg-danger/5"
          )}>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">{isProfit ? "💰" : "📉"}</span>
              <p className="text-sm font-semibold text-muted-foreground">
                {isProfit ? "이번달 순이익" : "이번달 적자"}
              </p>
              {isProfit
                ? <TrendingUp className="size-5 text-success ml-auto" />
                : <TrendingDown className="size-5 text-danger ml-auto" />}
            </div>
            <p className={cn(
              "text-5xl font-black tabular pl-10",
              isProfit ? "text-success" : "text-danger"
            )}>
              {isProfit ? "" : "-"}{formatKrw(Math.abs(profit))}
            </p>
            <div className="pl-10 mt-3 flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <span className="text-success font-semibold">↑ {formatKrw(revenue)}</span>
                <span>매출</span>
              </span>
              <Minus className="size-3 shrink-0" />
              <span className="flex items-center gap-1">
                <span className="text-danger font-semibold">↓ {formatKrw(totalExp)}</span>
                <span>지출</span>
              </span>
            </div>
            {/* 지출 세부 */}
            <div className="pl-10 mt-2 flex gap-4 text-xs text-muted-foreground">
              <span>고정 {formatKrw(totalFixed)}</span>
              <span>유동 {formatKrw(totalVar)}</span>
            </div>
          </div>

          {/* ── 안내 ── */}
          <p className="text-center text-xs text-muted-foreground pb-4">
            💡 금액을 클릭하면 바로 수정됩니다 · 🔄 아이콘으로 매달 자동 이월 설정
          </p>
        </>
      )}
    </div>
  );
}

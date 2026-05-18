import { supabase } from "@/integrations/supabase/client";

export type ExpenseCategory = "fixed" | "variable";

export interface BranchExpense {
  id: string;
  branch_id: string;
  year_month: string;
  category: ExpenseCategory;
  name: string;
  amount: number;
  memo: string | null;
  is_recurring: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertExpenseInput {
  branch_id: string;
  year_month: string;
  category: ExpenseCategory;
  name: string;
  amount: number;
  memo?: string;
  is_recurring?: boolean;
  sort_order?: number;
}

/** 해당 월 지출 목록 조회 (없으면 전월 이월 먼저 실행) */
export async function getMonthExpenses(
  branchId: string,
  yearMonth: string
): Promise<BranchExpense[]> {
  // 이월 초기화 (이미 데이터 있으면 0 반환)
  await supabase.rpc("init_monthly_expenses", {
    _branch_id: branchId,
    _year_month: yearMonth,
  });

  const { data, error } = await supabase
    .from("branch_expenses")
    .select("*")
    .eq("branch_id", branchId)
    .eq("year_month", yearMonth)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BranchExpense[];
}

/** 지출 항목 추가 */
export async function addExpense(input: UpsertExpenseInput): Promise<BranchExpense> {
  // sort_order: 현재 카테고리 내 최대 + 1
  const { count } = await supabase
    .from("branch_expenses")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", input.branch_id)
    .eq("year_month", input.year_month)
    .eq("category", input.category);

  const { data, error } = await supabase
    .from("branch_expenses")
    .insert({
      branch_id:    input.branch_id,
      year_month:   input.year_month,
      category:     input.category,
      name:         input.name.trim(),
      amount:       input.amount,
      memo:         input.memo?.trim() || null,
      is_recurring: input.is_recurring ?? input.category === "fixed",
      sort_order:   input.sort_order ?? (count ?? 0),
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as BranchExpense;
}

/** 지출 항목 수정 */
export async function updateExpense(
  id: string,
  patch: Partial<Pick<BranchExpense, "name" | "amount" | "memo" | "is_recurring" | "category">>
): Promise<BranchExpense> {
  const { data, error } = await supabase
    .from("branch_expenses")
    .update({
      ...(patch.name !== undefined         && { name:         patch.name.trim() }),
      ...(patch.amount !== undefined       && { amount:       patch.amount }),
      ...(patch.memo !== undefined         && { memo:         patch.memo?.trim() || null }),
      ...(patch.is_recurring !== undefined && { is_recurring: patch.is_recurring }),
      ...(patch.category !== undefined     && { category:     patch.category }),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as BranchExpense;
}

/** 지출 항목 삭제 */
export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase
    .from("branch_expenses")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

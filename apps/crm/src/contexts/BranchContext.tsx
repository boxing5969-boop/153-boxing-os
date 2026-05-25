/**
 * 현재 선택된 tenant + branch 컨텍스트.
 *
 * 보안 원칙:
 *  - 사용자는 자신이 속한 tenant 하나만 가능 (profile.company_id 가 곧 tenant_id)
 *  - 같은 tenant 안의 branch 들만 선택 가능 (super_admin/hq_admin/owner 는 전부, branch_owner 는 자기 지점만)
 *  - localStorage 에 branchId 만 저장 — tenant_id 는 항상 profile 에서 새로 읽음 (위조 방지)
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface BranchOption {
  id: string;
  name: string;
  status: string | null;
}

interface BranchCtxValue {
  tenantId: string | null;
  currentBranchId: string | null;
  branches: BranchOption[];
  loading: boolean;
  error: string | null;
  setBranchId: (id: string) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<BranchCtxValue | null>(null);

const STORAGE_KEY = "153os.currentBranchId";

export function BranchProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const tenantId = profile?.company_id ?? null;

  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [currentBranchId, setCurrentBranchIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBranches = useMemo(
    () => async (tenant: string) => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: qErr } = await supabase
          .from("branches")
          .select("id, name, status")
          .eq("company_id", tenant)
          .order("name", { ascending: true });
        if (qErr) throw new Error(qErr.message);
        const opts = (data ?? []) as BranchOption[];
        setBranches(opts);

        // 선택 우선순위: localStorage → 첫 번째 활성 지점 → 첫 지점
        const stored = (() => {
          try {
            return localStorage.getItem(STORAGE_KEY);
          } catch {
            return null;
          }
        })();
        const validStored = stored && opts.some((b) => b.id === stored) ? stored : null;
        const fallback =
          validStored ??
          opts.find((b) => b.status === "active")?.id ??
          opts[0]?.id ??
          null;
        setCurrentBranchIdState(fallback);
      } catch (e) {
        setError(e instanceof Error ? e.message : "branches load failed");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (tenantId) {
      void fetchBranches(tenantId);
    } else {
      setBranches([]);
      setCurrentBranchIdState(null);
    }
  }, [tenantId, fetchBranches]);

  const setBranchId = (id: string) => {
    if (!branches.some((b) => b.id === id)) return; // 다른 tenant 의 branch id 차단
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    setCurrentBranchIdState(id);
  };

  const refresh = async () => {
    if (tenantId) await fetchBranches(tenantId);
  };

  const value: BranchCtxValue = {
    tenantId,
    currentBranchId,
    branches,
    loading,
    error,
    setBranchId,
    refresh,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBranch(): BranchCtxValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBranch must be used inside <BranchProvider>");
  return v;
}

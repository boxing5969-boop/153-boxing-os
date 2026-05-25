/**
 * 사이드바 상단 tenant/branch 선택기.
 * - tenant 는 표시만 (사용자 1인 = 1 tenant)
 * - branch 는 dropdown 으로 선택 가능
 */
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";

export function BranchSelector() {
  const { profile } = useAuth();
  const { branches, currentBranchId, setBranchId, loading } = useBranch();

  return (
    <div className="px-4 py-3 border-b border-sidebar-border space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
        운영 중
      </div>
      <div className="text-xs font-semibold text-sidebar-foreground truncate">
        {profile?.company_id ? "테넌트" : "—"}
      </div>
      <div>
        <select
          value={currentBranchId ?? ""}
          onChange={(e) => setBranchId(e.target.value)}
          disabled={loading || branches.length === 0}
          className="w-full bg-sidebar-foreground/5 border border-sidebar-border rounded-md text-xs px-2 py-1.5 text-sidebar-foreground focus:outline-none focus:ring-2 focus:ring-sidebar-foreground/20"
          aria-label="지점 선택"
        >
          {branches.length === 0 ? (
            <option value="">지점 없음</option>
          ) : (
            branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.status && b.status !== "active" ? ` (${b.status})` : ""}
              </option>
            ))
          )}
        </select>
      </div>
    </div>
  );
}

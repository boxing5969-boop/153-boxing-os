/**
 * 역할 배정 관리 — Phase B 후속 1단계
 * staff_roles 를 조회/배정/비활성화. 조직 관리자(super_admin/hq_admin/owner)만 접근.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Plus, Trash2, Power } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  listStaffRoles, listAssignableProfiles, listBrands, listBranchesLookup,
  assignStaffRole, setStaffRoleStatus, removeStaffRole,
  ASSIGNABLE_ROLES, ROLE_LABELS, SCOPE_LABELS,
  type StaffRoleScope,
} from "@/services/staffRoles";
import { cn } from "@/lib/cn";

const ORG_ADMIN_ROLES = new Set(["super_admin", "hq_admin", "owner"]);

export default function StaffRolesPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const companyId = profile?.company_id ?? "";
  const canManage = !!profile && ORG_ADMIN_ROLES.has(profile.role);

  const [form, setForm] = useState({
    profile_id: "", role: "staff", scope: "branch" as StaffRoleScope,
    brand_id: "", branch_id: "",
  });
  const [err, setErr] = useState<string | null>(null);

  const rolesQ = useQuery({
    queryKey: ["staff-roles", companyId],
    queryFn: () => listStaffRoles(companyId),
    enabled: canManage && !!companyId,
  });
  const profilesQ = useQuery({
    queryKey: ["assignable-profiles", companyId],
    queryFn: () => listAssignableProfiles(companyId),
    enabled: canManage && !!companyId,
  });
  const brandsQ = useQuery({
    queryKey: ["brands-lookup", companyId],
    queryFn: () => listBrands(companyId),
    enabled: canManage && !!companyId,
  });
  const branchesQ = useQuery({
    queryKey: ["branches-lookup", companyId],
    queryFn: () => listBranchesLookup(companyId),
    enabled: canManage && !!companyId,
  });

  const assignM = useMutation({
    mutationFn: () =>
      assignStaffRole({
        profile_id: form.profile_id,
        company_id: companyId,
        role: form.role,
        scope: form.scope,
        brand_id: form.scope === "brand" ? form.brand_id : null,
        branch_id: form.scope === "branch" ? form.branch_id : null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["staff-roles", companyId] });
      setForm({ profile_id: "", role: "staff", scope: "branch", brand_id: "", branch_id: "" });
      setErr(null);
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "배정 실패"),
  });

  const statusM = useMutation({
    mutationFn: (v: { id: string; status: "active" | "inactive" }) =>
      setStaffRoleStatus(v.id, v.status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["staff-roles", companyId] }),
  });
  const removeM = useMutation({
    mutationFn: (id: string) => removeStaffRole(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["staff-roles", companyId] }),
  });

  if (!canManage) {
    return (
      <div className="rounded-xl bg-muted/40 border border-border px-4 py-8 text-center text-sm text-muted-foreground">
        역할 배정은 조직 관리자만 접근할 수 있습니다.
      </div>
    );
  }

  const formValid =
    !!form.profile_id && !!form.role &&
    (form.scope === "organization" ||
     (form.scope === "brand" && !!form.brand_id) ||
     (form.scope === "branch" && !!form.branch_id));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-primary" />
        <h1 className="text-xl font-black text-foreground">역할 배정 관리</h1>
      </div>

      {/* 배정 폼 */}
      <Card>
        <CardHeader className="text-sm font-bold text-foreground">새 역할 배정</CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">직원</span>
              <select
                value={form.profile_id}
                onChange={(e) => setForm({ ...form, profile_id: e.target.value })}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">선택</option>
                {(profilesQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">역할</span>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">범위</span>
              <select
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value as StaffRoleScope })}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {(["organization", "brand", "branch"] as StaffRoleScope[]).map((s) => (
                  <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
                ))}
              </select>
            </label>
            {form.scope === "brand" && (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">브랜드</span>
                <select
                  value={form.brand_id}
                  onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">선택</option>
                  {(brandsQ.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
            )}
            {form.scope === "branch" && (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">지점</span>
                <select
                  value={form.branch_id}
                  onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">선택</option>
                  {(branchesQ.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {err && <p className="text-xs text-danger">{err}</p>}
          <Button
            size="sm"
            disabled={!formValid || assignM.isPending}
            onClick={() => { setErr(null); assignM.mutate(); }}
          >
            <Plus className="size-3.5" />
            {assignM.isPending ? "배정 중…" : "역할 배정"}
          </Button>
        </CardContent>
      </Card>

      {/* 배정 목록 */}
      <Card>
        <CardHeader className="text-sm font-bold text-foreground">현재 역할 배정</CardHeader>
        <CardContent className="p-0">
          {rolesQ.isLoading ? (
            <div className="p-5 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : rolesQ.isError ? (
            <p className="p-5 text-sm text-danger">목록을 불러오지 못했습니다.</p>
          ) : (rolesQ.data ?? []).length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">배정된 역할이 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">직원</th>
                  <th className="text-left px-4 py-2 font-medium">역할</th>
                  <th className="text-left px-4 py-2 font-medium">범위</th>
                  <th className="text-left px-4 py-2 font-medium">대상</th>
                  <th className="text-left px-4 py-2 font-medium">상태</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(rolesQ.data ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-foreground">{r.profile_name ?? "—"}</td>
                    <td className="px-4 py-2.5">{ROLE_LABELS[r.role] ?? r.role}</td>
                    <td className="px-4 py-2.5">{SCOPE_LABELS[r.scope]}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {r.scope === "branch" ? r.branch_name
                        : r.scope === "brand" ? r.brand_name
                        : "조직 전체"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        r.status === "active"
                          ? "bg-success/10 text-success"
                          : "bg-muted text-muted-foreground"
                      )}>
                        {r.status === "active" ? "활성" : "비활성"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => statusM.mutate({
                            id: r.id,
                            status: r.status === "active" ? "inactive" : "active",
                          })}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                          title={r.status === "active" ? "비활성화" : "활성화"}
                        >
                          <Power className="size-3.5" />
                        </button>
                        <button
                          onClick={() => { if (confirm("이 역할 배정을 해제할까요?")) removeM.mutate(r.id); }}
                          className="p-1.5 rounded hover:bg-muted text-danger"
                          title="배정 해제"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

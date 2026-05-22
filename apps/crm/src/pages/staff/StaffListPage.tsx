import { useState } from "react";
import { errorMessage } from "@/lib/errors";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, AlertCircle, Users } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/staff/RoleBadge";
import { InviteStaffDialog } from "@/components/staff/InviteStaffDialog";
import { listStaff } from "@/services/staff";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate, formatPhone } from "@/lib/format";

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

export default function StaffListPage() {
  const { profile } = useAuth();
  const [openInvite, setOpenInvite] = useState(false);

  if (profile && !HQ_ROLES.has(profile.role)) {
    return <Navigate to="/" replace />;
  }

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["staff"],
    queryFn: listStaff,
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="직원"
        description="본사 전용 — 직원 목록 + 신규 초대 (auth.users + profiles 자동 생성)"
        action={
          <Button onClick={() => setOpenInvite(true)} className="gap-2 rounded-full">
            <Plus className="size-4" />
            직원 초대
          </Button>
        }
      />

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {isLoading && (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">로딩 중…</div>
        )}
        {isError && (
          <div className="px-5 py-16 text-center text-sm text-danger">
            오류: {errorMessage(error)}
          </div>
        )}
        {!isLoading && !isError && (data?.length ?? 0) === 0 && (
          <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
              <Users className="size-6 text-muted-foreground/60" />
            </div>
            <p className="text-sm font-semibold text-foreground">직원이 없습니다</p>
            <p className="text-xs text-muted-foreground">"직원 초대"로 추가하세요</p>
          </div>
        )}
        {!isLoading && !isError && (data?.length ?? 0) > 0 && (
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{s.name}</span>
                    <RoleBadge role={s.role} />
                    {!s.email && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                        <AlertCircle className="size-3" />
                        미연결
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {s.email && <span>{s.email}</span>}
                    {s.email && <span className="text-muted-foreground/40">·</span>}
                    <span>{s.branch_name ?? "본사"}</span>
                    {s.phone && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="tabular">{formatPhone(s.phone)}</span>
                      </>
                    )}
                    <span className="text-muted-foreground/40">·</span>
                    <span className="tabular">{formatDate(s.created_at)}</span>
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {s.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <InviteStaffDialog open={openInvite} onClose={() => setOpenInvite(false)} />
    </div>
  );
}

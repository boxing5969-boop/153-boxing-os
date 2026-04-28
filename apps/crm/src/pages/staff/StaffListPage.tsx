import { useState } from "react";
import { errorMessage } from "@/lib/errors";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, AlertCircle } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
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
          <Button onClick={() => setOpenInvite(true)}>
            <Plus className="size-4" />
            직원 초대
          </Button>
        }
      />

      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-foreground/10 text-left text-xs uppercase opacity-60">
            <tr>
              <th className="px-4 py-3">이름</th>
              <th className="px-4 py-3">이메일</th>
              <th className="px-4 py-3">역할</th>
              <th className="px-4 py-3">지점</th>
              <th className="px-4 py-3">전화</th>
              <th className="px-4 py-3">가입일</th>
              <th className="px-4 py-3">상태</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center opacity-60">
                  로딩 중…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-red-600">
                  오류: {errorMessage(error)}
                </td>
              </tr>
            )}
            {!isLoading && !isError && (data?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center opacity-60">
                  직원이 없습니다.
                </td>
              </tr>
            )}
            {(data ?? []).map((s) => (
              <tr key={s.id} className="border-b border-foreground/5">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3 opacity-80">
                  {s.email ?? (
                    <span className="text-yellow-700 inline-flex items-center gap-1">
                      <AlertCircle className="size-3" />
                      미연결
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <RoleBadge role={s.role} />
                </td>
                <td className="px-4 py-3 opacity-80">{s.branch_name ?? "본사"}</td>
                <td className="px-4 py-3 opacity-80">{formatPhone(s.phone)}</td>
                <td className="px-4 py-3 opacity-70">{formatDate(s.created_at)}</td>
                <td className="px-4 py-3 opacity-80">{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <InviteStaffDialog open={openInvite} onClose={() => setOpenInvite(false)} />
    </div>
  );
}

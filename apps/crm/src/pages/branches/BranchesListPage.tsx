import { Navigate } from "react-router-dom";
import { errorMessage } from "@/lib/errors";
import { useQuery } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesWithStats } from "@/services/branches";
import { formatDate } from "@/lib/format";

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

export default function BranchesListPage() {
  const { profile } = useAuth();

  if (profile && !HQ_ROLES.has(profile.role)) {
    return <Navigate to="/" replace />;
  }

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["branches-stats"],
    queryFn: getBranchesWithStats,
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="지점" description="본사 전용 — 지점별 회원 수 + 운영 현황" />
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-foreground/10 text-left text-xs uppercase opacity-60">
            <tr>
              <th className="px-4 py-3">지점명</th>
              <th className="px-4 py-3">주소</th>
              <th className="px-4 py-3">전화</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">전체 회원</th>
              <th className="px-4 py-3">정상 회원</th>
              <th className="px-4 py-3">개점일</th>
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
                  지점이 없습니다.
                </td>
              </tr>
            )}
            {(data ?? []).map((b) => (
              <tr key={b.id} className="border-b border-foreground/5">
                <td className="px-4 py-3 font-medium">{b.name}</td>
                <td className="px-4 py-3 opacity-80">{b.address ?? "—"}</td>
                <td className="px-4 py-3 opacity-80">{b.phone ?? "—"}</td>
                <td className="px-4 py-3 opacity-80">{b.status}</td>
                <td className="px-4 py-3">{b.member_count}</td>
                <td className="px-4 py-3 text-green-700">{b.active_member_count}</td>
                <td className="px-4 py-3 opacity-70">{formatDate(b.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

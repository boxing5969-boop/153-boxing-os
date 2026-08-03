/**
 * FC-3: 얼굴 출석 관리 — 등록 현황 + 얼굴 출입 로그 (본사·지점 운영자 전용).
 * 데이터는 전부 Workers API(/api/face-admin/*) 경유 — face_profiles 는 RLS 미공개.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScanFace } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import FaceEnrollmentsTab from "@/components/face/FaceEnrollmentsTab";
import FaceLogsTab from "@/components/face/FaceLogsTab";
import { cn } from "@/lib/cn";

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);
const ALLOWED_ROLES = new Set(["super_admin", "hq_admin", "branch_owner", "branch_manager"]);

type TabKey = "enrollments" | "logs";
const TABS: { key: TabKey; label: string }[] = [
  { key: "enrollments", label: "등록 현황" },
  { key: "logs", label: "출입 로그" },
];

interface BranchOption {
  id: string;
  name: string;
}

export default function FaceAttendancePage() {
  const { profile } = useAuth();
  const role = profile?.role ?? "";
  const isHq = HQ_ROLES.has(role);
  const allowed = ALLOWED_ROLES.has(role);

  const [tab, setTab] = useState<TabKey>("enrollments");
  const [branchId, setBranchId] = useState("");

  // 지점 필터 옵션 — 본사만 조회
  const { data: branches = [] } = useQuery({
    queryKey: ["face-branch-options"],
    enabled: isHq,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BranchOption[]> => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name")
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data ?? []) as BranchOption[];
    },
  });

  if (!allowed) {
    return (
      <div className="space-y-6">
        <PageHeader title="얼굴 출석" />
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <ScanFace className="size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-foreground">접근 권한이 없습니다</p>
          <p className="text-xs text-muted-foreground">
            얼굴 출석 관리는 본사·지점 운영자만 볼 수 있습니다
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="얼굴 출석"
        description="키오스크 얼굴인식 등록 현황과 출입 기록 — 등록 해제 시 인식 대상에서 제외됩니다"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* 밑줄 탭 */}
        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {isHq && (
          <Select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="w-44"
          >
            <option value="">전 지점</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {tab === "enrollments" ? (
        <FaceEnrollmentsTab branchId={branchId || null} />
      ) : (
        <FaceLogsTab branchId={branchId || null} />
      )}
    </div>
  );
}

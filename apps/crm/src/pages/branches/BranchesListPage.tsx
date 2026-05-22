import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { Building2, Plus, ChevronRight, MapPin, Phone } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { getBranchesWithStats, type BranchStats } from "@/services/branches";
import { cn } from "@/lib/cn";
import BranchFormDialog from "@/components/branches/BranchFormDialog";

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

const STATUS_STYLE: Record<string, string> = {
  active:   "bg-success/10 text-success",
  inactive: "bg-muted text-muted-foreground",
  closed:   "bg-danger/10 text-danger",
};
const STATUS_LABEL: Record<string, string> = {
  active: "운영중", inactive: "비활성", closed: "폐점",
};

function BranchCard({ b, onClick }: { b: BranchStats; onClick: () => void }) {
  const fillPct = b.member_count > 0 ? Math.round((b.active_member_count / b.member_count) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-2xl border border-border bg-card p-5 text-left shadow-card transition-all hover:border-primary/40 hover:shadow-lg"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
            <Building2 className="size-5 text-primary" />
          </div>
          <div>
            <p className="text-base font-bold leading-tight text-foreground">{b.name}</p>
            <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[b.status] ?? STATUS_STYLE.inactive)}>
              {STATUS_LABEL[b.status] ?? b.status}
            </span>
          </div>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary/60" />
      </div>

      {(b.address || b.phone) && (
        <div className="mb-4 space-y-1">
          {b.address && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{b.address}</span>
            </div>
          )}
          {b.phone && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="size-3 shrink-0" />
              <span>{b.phone}</span>
            </div>
          )}
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-center">
          <p className="text-lg font-black text-foreground tabular">{b.member_count}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">전체 회원</p>
        </div>
        <div className="rounded-xl border border-success/20 bg-success/5 px-3 py-2.5 text-center">
          <p className="text-lg font-black text-success tabular">{b.active_member_count}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">정상 회원</p>
        </div>
        <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-center">
          <p className="text-lg font-black text-foreground tabular">{b.device_count}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">단말기</p>
        </div>
      </div>

      {b.member_count > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>활성 비율</span>
            <span className="font-semibold text-foreground tabular">{fillPct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-success transition-all"
              style={{ width: `${fillPct}%` }}
            />
          </div>
        </div>
      )}
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse space-y-4 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center gap-3">
        <div className="size-12 rounded-2xl bg-muted" />
        <div className="space-y-1.5">
          <div className="h-4 w-28 rounded bg-muted" />
          <div className="h-3 w-14 rounded-full bg-muted" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[0,1,2].map(i => <div key={i} className="h-14 rounded-xl bg-muted" />)}
      </div>
      <div className="h-1.5 rounded-full bg-muted" />
    </div>
  );
}

export default function BranchesListPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["branches-stats"],
    queryFn: getBranchesWithStats,
    staleTime: 60_000,
  });

  if (profile && !HQ_ROLES.has(profile.role)) return <Navigate to="/" replace />;

  const branches = data ?? [];
  const totalActive = branches.filter(b => b.status === "active").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="지점 관리"
        description="전국 지점 현황 및 운영 정보"
        badge={
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
            {totalActive}개 운영중
          </span>
        }
        action={
          <Button onClick={() => setShowAdd(true)} className="gap-2 rounded-full">
            <Plus className="size-4" />
            지점 추가
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0,1,2].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : branches.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card py-16 text-center shadow-card">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
            <Building2 className="size-7 text-muted-foreground/60" />
          </div>
          <p className="font-semibold text-foreground">등록된 지점이 없습니다</p>
          <p className="text-sm text-muted-foreground">지점 추가 버튼으로 첫 지점을 등록하세요</p>
          <Button onClick={() => setShowAdd(true)} className="mt-2 gap-2 rounded-full">
            <Plus className="size-4" />
            지점 추가
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map(b => (
            <BranchCard key={b.id} b={b} onClick={() => navigate(`/branches/${b.id}`)} />
          ))}
        </div>
      )}

      <BranchFormDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSuccess={() => { setShowAdd(false); void refetch(); }}
      />
    </div>
  );
}

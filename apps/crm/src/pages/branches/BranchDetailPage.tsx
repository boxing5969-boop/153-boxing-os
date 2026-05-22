import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Building2, MapPin, Phone, Users, Monitor,
  Pencil, XCircle, UserCircle2,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getBranchDetail } from "@/services/branches";
import { listDevices } from "@/services/devices";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/format";
import MemberStatusBadge from "@/components/members/MemberStatusBadge";
import { cn } from "@/lib/cn";
import BranchFormDialog from "@/components/branches/BranchFormDialog";
import BranchKakaoSettingsCard from "@/components/branches/BranchKakaoSettingsCard";
import { BranchPlanPresetsCard } from "@/components/branches/BranchPlanPresetsCard";
import type { MemberStatus } from "@153/shared";

const STATUS_STYLE: Record<string, string> = {
  active:   "bg-success/10 text-success border-success/20",
  inactive: "bg-muted text-muted-foreground border-border",
  closed:   "bg-danger/10 text-danger border-danger/20",
};
const STATUS_LABEL: Record<string, string> = {
  active: "운영중", inactive: "비활성", closed: "폐점",
};

const DEVICE_STATUS_STYLE: Record<string, string> = {
  active:   "bg-success/10 text-success",
  offline:  "bg-muted text-muted-foreground",
  error:    "bg-danger/10 text-danger",
  inactive: "bg-muted text-muted-foreground",
};

function StatBox({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 text-center shadow-card">
      <p className="text-2xl font-black text-foreground tabular">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
      {sub && <p className="mt-1 text-[11px] font-semibold text-primary tabular">{sub}</p>}
    </div>
  );
}

function avatarColor(name: string) {
  const colors = ["bg-red-500","bg-orange-500","bg-amber-500","bg-green-500","bg-teal-500","bg-blue-500","bg-violet-500","bg-pink-500"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
}

export default function BranchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);

  const branchQ = useQuery({
    queryKey: ["branch-detail", id],
    queryFn: () => getBranchDetail(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

  const membersQ = useQuery({
    queryKey: ["branch-members", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select("id, name, status, phone, created_at")
        .eq("branch_id", id!)
        .order("name")
        .limit(20);
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; status: string; phone: string | null; created_at: string }[];
    },
    enabled: !!id,
    staleTime: 30_000,
  });

  const devicesQ = useQuery({
    queryKey: ["branch-devices", id],
    queryFn: () => listDevices({ branch_id: id }),
    enabled: !!id,
    staleTime: 30_000,
  });

  const b = branchQ.data;

  if (branchQ.isLoading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-48 rounded-lg bg-muted" />
        <div className="h-40 rounded-2xl bg-muted" />
      </div>
    );
  }

  if (!b) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <XCircle className="size-12 text-danger/40" />
        <p className="font-semibold text-foreground">지점을 찾을 수 없습니다</p>
        <Link to="/branches"><Button variant="outline" className="rounded-full">목록으로</Button></Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl animate-fade-in space-y-6">
      <div>
        <Link to="/branches" className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" />
          지점 목록
        </Link>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-black tracking-tight text-foreground">{b.name}</h1>
          <Button variant="outline" size="sm" onClick={() => setShowEdit(true)} className="gap-2 rounded-full">
            <Pencil className="size-4" />
            편집
          </Button>
        </div>
      </div>

      {/* 상태 + 기본 정보 */}
      <Card className="rounded-2xl">
        <CardContent className="pt-6">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 shadow-card">
              <Building2 className="size-7 text-primary" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{b.name}</p>
              <span className={cn("inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLE[b.status] ?? STATUS_STYLE.inactive)}>
                {STATUS_LABEL[b.status] ?? b.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {b.address && (
              <div className="flex items-start gap-2 text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0 text-primary/60" />
                <span>{b.address}</span>
              </div>
            )}
            {b.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="size-4 shrink-0 text-primary/60" />
                <span>{b.phone}</span>
              </div>
            )}
            {b.manager_name && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <UserCircle2 className="size-4 shrink-0 text-primary/60" />
                <span>점주: <span className="font-semibold text-foreground">{b.manager_name}</span></span>
              </div>
            )}
            {b.manager_phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="size-4 shrink-0 text-primary/60" />
                <span>점주 연락처: <span className="font-semibold text-foreground">{b.manager_phone}</span></span>
              </div>
            )}
          </div>

          <div className="mt-6 grid grid-cols-3 gap-3">
            <StatBox label="전체 회원" value={b.member_count} />
            <StatBox label="정상 회원" value={b.active_member_count} sub={b.member_count > 0 ? `${Math.round(b.active_member_count/b.member_count*100)}%` : undefined} />
            <StatBox label="단말기" value={b.device_count} />
          </div>
        </CardContent>
      </Card>

      {/* 회원 목록 */}
      <Card className="rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">소속 회원</span>
            <span className="text-xs text-muted-foreground">(최근 20명)</span>
          </div>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => navigate(`/members?branch_id=${id}`)}>
            전체 보기
          </Button>
        </div>
        <div>
          {membersQ.isLoading && (
            <div className="divide-y divide-border/60">
              {[0,1,2,3].map(i => (
                <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-3.5">
                  <div className="size-9 rounded-full bg-muted" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-24 rounded bg-muted" />
                    <div className="h-3 w-16 rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!membersQ.isLoading && (membersQ.data ?? []).length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
                <Users className="size-6 text-muted-foreground/60" />
              </div>
              <p className="text-sm text-muted-foreground">소속 회원이 없습니다</p>
            </div>
          )}
          <div className="divide-y divide-border/60">
            {(membersQ.data ?? []).map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => navigate(`/members/${m.id}`)}
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/40"
              >
                <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white", avatarColor(m.name))}>
                  {m.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{m.name}</p>
                  {m.phone && <p className="text-xs text-muted-foreground tabular">{m.phone}</p>}
                </div>
                <MemberStatusBadge status={m.status as MemberStatus} />
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* 단말기 목록 */}
      <Card className="rounded-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <Monitor className="size-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">단말기</span>
        </div>
        <div>
          {devicesQ.isLoading && (
            <div className="animate-pulse px-5 py-3 text-sm text-muted-foreground">로딩 중...</div>
          )}
          {!devicesQ.isLoading && (devicesQ.data ?? []).length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
                <Monitor className="size-6 text-muted-foreground/60" />
              </div>
              <p className="text-sm text-muted-foreground">등록된 단말기가 없습니다</p>
            </div>
          )}
          <div className="divide-y divide-border/60">
            {(devicesQ.data ?? []).map(d => (
              <button
                key={d.id}
                type="button"
                onClick={() => navigate(`/devices/${d.id}`)}
                className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-muted/40"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">{d.device_name}</p>
                  <p className="text-xs text-muted-foreground">{d.vendor}</p>
                </div>
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", DEVICE_STATUS_STYLE[d.status] ?? "bg-muted text-muted-foreground")}>
                  {d.status}
                </span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* 이용권 플랜 설정 */}
      <BranchPlanPresetsCard branchId={b.id} />

      {/* Kakao AlimTalk Settings */}
      <BranchKakaoSettingsCard
        branchId={b.id}
        config={b}
        onSaved={() => void qc.invalidateQueries({ queryKey: ["branch-detail", id] })}
      />

      <BranchFormDialog
        open={showEdit}
        onClose={() => setShowEdit(false)}
        onSuccess={() => {
          setShowEdit(false);
          void qc.invalidateQueries({ queryKey: ["branch-detail", id] });
          void qc.invalidateQueries({ queryKey: ["branches-stats"] });
        }}
        branch={b}
      />
    </div>
  );
}

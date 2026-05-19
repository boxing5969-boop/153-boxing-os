/**
 * HR — 직원 목록 / 신규 등록
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserCog, Plus, Phone, Mail, Search, ChevronRight,
  UserCheck, UserX, Briefcase, Building2, ArrowLeft,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import {
  listStaff, createStaff, EMPLOYMENT_TYPE_LABELS,
  type Staff, type EmploymentType,
} from "@/services/hr";
import { getBranchesWithStats } from "@/services/branches";
import { cn } from "@/lib/cn";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-success/10 text-success",
  inactive: "bg-muted text-muted-foreground",
  resigned: "bg-danger/10 text-danger",
};
const STATUS_LABELS: Record<string, string> = {
  active: "재직중",
  inactive: "휴직",
  resigned: "퇴사",
};
const EMPLOYMENT_COLORS: Record<string, string> = {
  regular: "bg-blue-50 text-blue-700",
  parttime: "bg-purple-50 text-purple-700",
  freelancer: "bg-orange-50 text-orange-700",
  owner: "bg-brand/10 text-brand",
};

/** 숫자 → 콤마 표시 (예: 3000000 → "3,000,000") */
function formatNumber(val: string): string {
  const n = val.replace(/[^0-9]/g, "");
  return n ? parseInt(n).toLocaleString() : "";
}
/** 콤마 제거 후 숫자 문자열 반환 */
function parseNumber(val: string): string {
  return val.replace(/[^0-9]/g, "");
}

export default function HrStaffListPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // 본사 계정은 branch_id가 없으므로 선택된 지점을 별도 관리
  const profileBranchId = profile?.branch_id ?? "";
  const isHqUser = !profileBranchId;
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const branchId = isHqUser ? selectedBranchId : profileBranchId;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [showDialog, setShowDialog] = useState(false);

  const [form, setForm] = useState({
    name: "", phone: "", email: "", employment_type: "regular" as EmploymentType,
    position: "", start_date: "", base_salary: "", hourly_wage: "", weekly_hours: "",
  });

  // 본사 계정용 지점 목록
  const { data: branches = [] } = useQuery({
    queryKey: ["branches-list"],
    queryFn: getBranchesWithStats,
    enabled: isHqUser,
  });

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ["hr-staff", branchId, statusFilter],
    queryFn: () => listStaff(branchId, statusFilter === "all" ? undefined : statusFilter as Staff["status"]),
    enabled: !!branchId,
  });

  const createMutation = useMutation({
    mutationFn: () => createStaff(branchId, {
      ...form,
      base_salary: form.base_salary ? parseInt(parseNumber(form.base_salary)) : undefined,
      hourly_wage: form.hourly_wage ? parseInt(parseNumber(form.hourly_wage)) : undefined,
      weekly_hours: form.weekly_hours ? parseFloat(form.weekly_hours) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-staff", branchId] });
      setShowDialog(false);
      setForm({ name: "", phone: "", email: "", employment_type: "regular", position: "", start_date: "", base_salary: "", hourly_wage: "", weekly_hours: "" });
    },
  });

  const filtered = staff.filter(s =>
    s.name.includes(search) ||
    (s.phone ?? "").includes(search) ||
    (s.position ?? "").includes(search)
  );

  const isSalary = form.employment_type === "regular" || form.employment_type === "owner" || form.employment_type === "freelancer";
  const isHourly = form.employment_type === "parttime";

  return (
    <div className="flex-1 overflow-y-auto bg-muted/30">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" />
              뒤로
            </Button>
            <div className="flex size-9 items-center justify-center rounded-lg bg-brand/10">
              <UserCog className="size-5 text-brand" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">직원 관리</h1>
              <p className="text-xs text-muted-foreground">직원 등록, 계약, 급여 정보 통합 관리</p>
            </div>
          </div>
          <Button onClick={() => setShowDialog(true)} className="gap-2" disabled={!branchId}>
            <Plus className="size-4" /> 직원 등록
          </Button>
        </div>

        {/* 본사 계정: 지점 선택 */}
        {isHqUser && (
          <Card className="px-4 py-3 flex items-center gap-3">
            <Building2 className="size-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground shrink-0">지점 선택</span>
            <Select
              value={selectedBranchId}
              onChange={e => setSelectedBranchId(e.target.value)}
              className="h-8 text-sm"
            >
              <option value="">지점을 선택하세요</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Card>
        )}

        {/* 지점 미선택 안내 */}
        {isHqUser && !selectedBranchId ? (
          <Card className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <Building2 className="size-10 opacity-30" />
            <p className="text-sm">위에서 지점을 선택하면 직원 목록이 표시됩니다</p>
          </Card>
        ) : (
          <>
            {/* 통계 */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "재직 중", count: staff.filter(s => s.status === "active").length, icon: UserCheck, color: "text-success" },
                { label: "전체 직원", count: staff.length, icon: Briefcase, color: "text-brand" },
                { label: "퇴사", count: staff.filter(s => s.status === "resigned").length, icon: UserX, color: "text-muted-foreground" },
              ].map(({ label, count, icon: Icon, color }) => (
                <Card key={label} className="px-4 py-3 flex items-center gap-3">
                  <Icon className={cn("size-5", color)} />
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold text-foreground">{count}</p>
                  </div>
                </Card>
              ))}
            </div>

            {/* 검색 + 필터 */}
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="이름, 연락처, 직책 검색" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="flex gap-1.5">
                {[["active", "재직중"], ["inactive", "휴직"], ["resigned", "퇴사"], ["all", "전체"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setStatusFilter(val ?? "")}
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      statusFilter === val ? "bg-brand text-white" : "bg-muted text-muted-foreground hover:bg-muted/70")}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* 직원 목록 */}
            {isLoading ? (
              <div className="text-center py-20 text-muted-foreground text-sm">불러오는 중…</div>
            ) : filtered.length === 0 ? (
              <Card className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                <UserCog className="size-10 opacity-30" />
                <p className="text-sm">등록된 직원이 없습니다</p>
                <Button variant="outline" size="sm" onClick={() => setShowDialog(true)}>
                  <Plus className="size-4 mr-1.5" /> 첫 직원 등록
                </Button>
              </Card>
            ) : (
              <div className="space-y-2">
                {filtered.map(s => (
                  <Card key={s.id} className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => navigate(`/hr/staff/${s.id}`)}>
                    <div className="size-10 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-brand">{s.name.slice(0, 1)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{s.name}</span>
                        {s.position && <span className="text-xs text-muted-foreground">{s.position}</span>}
                        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", EMPLOYMENT_COLORS[s.employment_type])}>
                          {EMPLOYMENT_TYPE_LABELS[s.employment_type]}
                        </span>
                        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", STATUS_STYLES[s.status])}>
                          {STATUS_LABELS[s.status]}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        {s.phone && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="size-3" />{s.phone}</span>}
                        {s.email && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Mail className="size-3" />{s.email}</span>}
                        {s.start_date && <span className="text-xs text-muted-foreground">입사 {s.start_date}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0 hidden sm:block">
                      {s.base_salary ? <p className="text-sm font-semibold text-foreground">{s.base_salary.toLocaleString()}원/월</p>
                        : s.hourly_wage ? <p className="text-sm font-semibold text-foreground">{s.hourly_wage.toLocaleString()}원/시</p> : null}
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 직원 등록 다이얼로그 */}
      <Dialog open={showDialog} onClose={() => setShowDialog(false)} title="직원 등록" className="max-w-lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>이름 *</Label>
              <Input placeholder="홍길동" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>직책</Label>
              <Input placeholder="코치, 트레이너 등" value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>연락처</Label>
              <Input placeholder="01012345678" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>이메일</Label>
              <Input placeholder="email@example.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>고용 형태 *</Label>
            <Select value={form.employment_type}
              onChange={e => setForm(f => ({ ...f, employment_type: e.target.value as EmploymentType }))}>
              {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>입사일</Label>
            <Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
          </div>
          {isSalary && (
            <div className="space-y-1.5">
              <Label>월급 (원)</Label>
              <div className="relative">
                <Input
                  placeholder="3,000,000"
                  value={formatNumber(form.base_salary)}
                  onChange={e => setForm(f => ({ ...f, base_salary: parseNumber(e.target.value) }))}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">원</span>
              </div>
              {form.employment_type === "freelancer" && (
                <p className="text-xs text-warning">프리랜서는 지급액의 3.3%가 원천징수됩니다.</p>
              )}
            </div>
          )}
          {isHourly && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>시급 (원)</Label>
                <div className="relative">
                  <Input
                    placeholder="12,000"
                    value={formatNumber(form.hourly_wage)}
                    onChange={e => setForm(f => ({ ...f, hourly_wage: parseNumber(e.target.value) }))}
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">원</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>주당 계약 시간</Label>
                <Input type="number" placeholder="20" value={form.weekly_hours}
                  onChange={e => setForm(f => ({ ...f, weekly_hours: e.target.value }))} />
              </div>
            </div>
          )}
          {createMutation.error && (
            <p className="text-sm text-danger">{(createMutation.error as Error).message}</p>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-border mt-4">
            <Button variant="outline" onClick={() => setShowDialog(false)}>취소</Button>
            <Button onClick={() => createMutation.mutate()}
              disabled={!form.name || !form.employment_type || !branchId || createMutation.isPending}>
              {createMutation.isPending ? "등록 중…" : "등록"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

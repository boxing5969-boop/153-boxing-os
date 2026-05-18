/**
 * HR — 직원 상세 (기본정보 + 계약서 목록 + 급여 이력)
 */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, UserCog, Phone, Mail, Building2, FileSignature,
  BanknoteIcon, Plus, Send, Eye, CheckCircle2, Edit, Save, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getStaff, updateStaff, listContracts, createContract,
  sendContract, listPayroll, updatePayrollStatus,
  EMPLOYMENT_TYPE_LABELS, CONTRACT_TYPE_LABELS, CONTRACT_STATUS_LABELS,
  PAYROLL_STATUS_LABELS, formatKRW, getContractTemplate,
  type ContractType, type PayrollStatus, resignStaff,
} from "@/services/hr";
import { cn } from "@/lib/cn";

const CONTRACT_STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-50 text-blue-700",
  signed: "bg-success/10 text-success",
  expired: "bg-warning/10 text-warning",
  canceled: "bg-danger/10 text-danger",
};

const PAYROLL_STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-50 text-blue-700",
  paid: "bg-success/10 text-success",
};

export default function HrStaffDetailPage() {
  const { staffId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [showContractDialog, setShowContractDialog] = useState(false);
  const [contractForm, setContractForm] = useState({ contract_type: "employment" as ContractType, title: "", valid_from: "", valid_until: "" });
  const [tab, setTab] = useState<"info" | "contracts" | "payroll">("info");

  const { data: staff, isLoading } = useQuery({
    queryKey: ["hr-staff-detail", staffId],
    queryFn: () => getStaff(staffId),
    enabled: !!staffId,
  });

  const { data: contracts = [] } = useQuery({
    queryKey: ["hr-contracts", staffId],
    queryFn: () => listContracts(staffId),
    enabled: !!staffId && tab === "contracts",
  });

  const { data: payrolls = [] } = useQuery({
    queryKey: ["hr-payroll", staffId],
    queryFn: () => listPayroll(staffId),
    enabled: !!staffId && tab === "payroll",
  });

  const updateMutation = useMutation({
    mutationFn: () => updateStaff(staffId, editForm as Record<string, string>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-staff-detail", staffId] });
      setEditMode(false);
    },
  });

  const resignMutation = useMutation({
    mutationFn: () => resignStaff(staffId),
    onSuccess: () => navigate("/hr/staff"),
  });

  const contractMutation = useMutation({
    mutationFn: () => createContract(staffId, {
      ...contractForm,
      content: staff ? getContractTemplate(contractForm.contract_type, staff, "") : {},
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr-contracts", staffId] });
      setShowContractDialog(false);
      setTab("contracts");
    },
  });

  const sendContractMutation = useMutation({
    mutationFn: (contractId: string) => sendContract(contractId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr-contracts", staffId] }),
  });

  const payrollStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PayrollStatus }) => updatePayrollStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr-payroll", staffId] }),
  });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground text-sm">불러오는 중…</div>;
  if (!staff) return <div className="p-8 text-center text-danger text-sm">직원을 찾을 수 없습니다</div>;

  const startEdit = () => {
    setEditForm({
      name: staff.name,
      phone: staff.phone ?? "",
      email: staff.email ?? "",
      position: staff.position ?? "",
      base_salary: staff.base_salary ? String(staff.base_salary) : "",
      hourly_wage: staff.hourly_wage ? String(staff.hourly_wage) : "",
      start_date: staff.start_date ?? "",
      note: staff.note ?? "",
    });
    setEditMode(true);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-muted/30">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* 헤더 */}
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/hr/staff")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="size-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">{staff.name}</h1>
              <span className="text-xs bg-brand/10 text-brand px-2 py-0.5 rounded-full font-semibold">
                {EMPLOYMENT_TYPE_LABELS[staff.employment_type]}
              </span>
              {staff.position && <span className="text-xs text-muted-foreground">{staff.position}</span>}
            </div>
            {staff.start_date && (
              <p className="text-xs text-muted-foreground mt-0.5">입사일: {staff.start_date}</p>
            )}
          </div>
          <div className="flex gap-2">
            {!editMode ? (
              <>
                <Button variant="outline" size="sm" onClick={startEdit}><Edit className="size-3.5 mr-1.5" />수정</Button>
                {staff.status === "active" && (
                  <Button variant="outline" size="sm" className="text-danger border-danger/30 hover:bg-danger/5"
                    onClick={() => { if (confirm(`${staff.name}님을 퇴사 처리하시겠습니까?`)) resignMutation.mutate(); }}>
                    퇴사 처리
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditMode(false)}><X className="size-3.5 mr-1" />취소</Button>
                <Button size="sm" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                  <Save className="size-3.5 mr-1.5" />저장
                </Button>
              </>
            )}
          </div>
        </div>

        {/* 탭 */}
        <div className="flex gap-1 border-b border-border">
          {([["info", "기본 정보", UserCog], ["contracts", "계약서", FileSignature], ["payroll", "급여 명세", BanknoteIcon]] as const).map(([key, lbl, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                tab === key
                  ? "border-brand text-brand"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-4" />{lbl}
            </button>
          ))}
        </div>

        {/* ── 기본 정보 탭 ── */}
        {tab === "info" && (
          <Card>
            <CardContent className="pt-5 space-y-4">
              {editMode ? (
                <div className="grid grid-cols-2 gap-4">
                  {[
                    ["이름", "name", "text", "홍길동"],
                    ["연락처", "phone", "tel", "01012345678"],
                    ["이메일", "email", "email", "email@example.com"],
                    ["직책", "position", "text", "코치"],
                    ["입사일", "start_date", "date", ""],
                    ...(staff.employment_type !== "parttime"
                      ? [["월급 (원)", "base_salary", "number", "3000000"]] as const
                      : [["시급 (원)", "hourly_wage", "number", "12000"]] as const),
                  ].map(([lbl, key, type, placeholder]) => (
                    <div key={key} className="space-y-1.5">
                      <Label>{lbl}</Label>
                      <Input
                        type={type}
                        placeholder={placeholder}
                        value={editForm[key] ?? ""}
                        onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                      />
                    </div>
                  ))}
                  <div className="col-span-2 space-y-1.5">
                    <Label>메모</Label>
                    <Input
                      value={editForm.note ?? ""}
                      onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))}
                      placeholder="특이사항, 메모"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {[
                    ["고용 형태", EMPLOYMENT_TYPE_LABELS[staff.employment_type]],
                    ["직책", staff.position ?? "—"],
                    ["연락처", staff.phone ?? "—"],
                    ["이메일", staff.email ?? "—"],
                    ["입사일", staff.start_date ?? "—"],
                    ["퇴사일", staff.end_date ?? "—"],
                    ["월급", staff.base_salary ? formatKRW(staff.base_salary) : "—"],
                    ["시급", staff.hourly_wage ? formatKRW(staff.hourly_wage) : "—"],
                    ["주당 시간", staff.weekly_hours ? `${staff.weekly_hours}시간` : "—"],
                    ["상태", staff.status === "active" ? "재직중" : staff.status === "resigned" ? "퇴사" : "휴직"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs text-muted-foreground">{k}</p>
                      <p className="text-sm font-medium text-foreground">{v}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* 은행 정보 */}
              {!editMode && (
                <div className="pt-4 border-t border-border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">급여 계좌</p>
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      ["은행", staff.bank_name ?? "미입력"],
                      ["계좌번호", staff.bank_account ?? "미입력"],
                      ["예금주", staff.bank_holder ?? "미입력"],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <p className="text-xs text-muted-foreground">{k}</p>
                        <p className="text-sm font-medium text-foreground">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!editMode && staff.note && (
                <div className="pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-1">메모</p>
                  <p className="text-sm text-foreground">{staff.note}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── 계약서 탭 ── */}
        {tab === "contracts" && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowContractDialog(true)} className="gap-1.5">
                <Plus className="size-4" /> 계약서 작성
              </Button>
            </div>
            {contracts.length === 0 ? (
              <Card className="py-14 flex flex-col items-center gap-3 text-muted-foreground">
                <FileSignature className="size-9 opacity-30" />
                <p className="text-sm">등록된 계약서가 없습니다</p>
              </Card>
            ) : (
              contracts.map(c => (
                <Card key={c.id} className="px-5 py-4 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-foreground text-sm">{c.title}</span>
                      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", CONTRACT_STATUS_COLORS[c.status])}>
                        {CONTRACT_STATUS_LABELS[c.status]}
                      </span>
                      <span className="text-xs text-muted-foreground">{CONTRACT_TYPE_LABELS[c.contract_type]}</span>
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                      {c.valid_from && <span>시작: {c.valid_from}</span>}
                      {c.valid_until && <span>종료: {c.valid_until}</span>}
                      {c.sent_at && <span>발송: {c.sent_at.slice(0, 10)}</span>}
                      {c.signed_at && <span className="text-success flex items-center gap-0.5"><CheckCircle2 className="size-3" />서명: {c.signed_at.slice(0, 10)}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {c.file_url && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={c.file_url} target="_blank" rel="noreferrer"><Eye className="size-3.5 mr-1" />보기</a>
                      </Button>
                    )}
                    {c.status === "draft" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendContractMutation.mutate(c.id)}
                        disabled={sendContractMutation.isPending}
                      >
                        <Send className="size-3.5 mr-1" />발송
                      </Button>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {/* ── 급여 명세 탭 ── */}
        {tab === "payroll" && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => navigate(`/hr/payroll/new?staffId=${staffId}`)} className="gap-1.5">
                <Plus className="size-4" /> 급여 등록
              </Button>
            </div>
            {payrolls.length === 0 ? (
              <Card className="py-14 flex flex-col items-center gap-3 text-muted-foreground">
                <BanknoteIcon className="size-9 opacity-30" />
                <p className="text-sm">등록된 급여 명세가 없습니다</p>
              </Card>
            ) : (
              payrolls.map(p => (
                <Card key={p.id} className="px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{p.year}년 {p.month}월</span>
                        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", PAYROLL_STATUS_COLORS[p.status])}>
                          {PAYROLL_STATUS_LABELS[p.status]}
                        </span>
                      </div>
                      <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                        <span>지급액 <strong className="text-foreground">{formatKRW(p.gross_pay)}</strong></span>
                        <span>공제 <strong className="text-danger">{formatKRW(p.total_deduction)}</strong></span>
                        <span>실수령 <strong className="text-success">{formatKRW(p.net_pay)}</strong></span>
                        <span>사업주부담 <strong className="text-muted-foreground">{formatKRW(p.employer_total)}</strong></span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {p.status === "draft" && (
                        <Button size="sm" variant="outline"
                          onClick={() => payrollStatusMutation.mutate({ id: p.id, status: "confirmed" })}>
                          확정
                        </Button>
                      )}
                      {p.status === "confirmed" && (
                        <Button size="sm"
                          onClick={() => payrollStatusMutation.mutate({ id: p.id, status: "paid" })}>
                          지급완료
                        </Button>
                      )}
                      {p.paid_at && <span className="text-xs text-success self-center">지급일: {p.paid_at.slice(0, 10)}</span>}
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}
      </div>

      {/* 계약서 작성 다이얼로그 */}
      <Dialog open={showContractDialog} onOpenChange={setShowContractDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>계약서 작성</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>계약서 종류</Label>
              <Select value={contractForm.contract_type} onValueChange={v => setContractForm(f => ({ ...f, contract_type: v as ContractType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CONTRACT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>계약서 제목</Label>
              <Input
                placeholder="예: 2026년 근로계약서"
                value={contractForm.title}
                onChange={e => setContractForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>시작일</Label>
                <Input type="date" value={contractForm.valid_from} onChange={e => setContractForm(f => ({ ...f, valid_from: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>종료일</Label>
                <Input type="date" value={contractForm.valid_until} onChange={e => setContractForm(f => ({ ...f, valid_until: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowContractDialog(false)}>취소</Button>
            <Button
              onClick={() => contractMutation.mutate()}
              disabled={!contractForm.title || contractMutation.isPending}
            >
              {contractMutation.isPending ? "작성 중…" : "작성"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

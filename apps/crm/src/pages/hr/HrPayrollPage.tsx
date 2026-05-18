/**
 * HR — 급여 계산기 + 지점 월별 급여 현황
 * 상단: 지점 전체 월별 인건비 요약
 * 하단: 개별 급여 계산기 (4대보험, 실수령액 실시간 계산)
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BanknoteIcon, Calculator, ArrowLeft, TrendingUp,
  ChevronDown, ChevronUp, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import {
  getPayrollSummary, calculatePayroll, createPayroll, listStaff,
  EMPLOYMENT_TYPE_LABELS, formatKRW,
  type EmploymentType, type PayrollCalculation,
} from "@/services/hr";
import { cn } from "@/lib/cn";

const INSURANCE_RATES = [
  { label: "국민연금", employee: "4.5%", employer: "4.5%", key: "national_pension" as const },
  { label: "건강보험", employee: "3.545%", employer: "3.545%", key: "health_insurance" as const },
  { label: "장기요양", employee: "건강보험료×6.475%", employer: "건강보험료×6.475%", key: "long_term_care" as const },
  { label: "고용보험", employee: "0.9%", employer: "1.15%", key: "employment_insurance" as const },
  { label: "산재보험", employee: "—", employer: "~1% (헬스장)", key: "employer_accident" as const },
];

export default function HrPayrollPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preStaffId = searchParams.get("staffId") ?? "";

  const branchId = profile?.branch_id ?? "";
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  // 요약 필터
  const [summaryYear, setSummaryYear] = useState(currentYear);

  // 계산기 상태
  const [calcForm, setCalcForm] = useState({
    staffId: preStaffId,
    year: String(currentYear),
    month: String(currentMonth),
    employment_type: "regular" as EmploymentType,
    base_pay: "",
    allowance: "0",
    bonus: "0",
    work_hours: "",
    hourly_wage: "",
  });
  const [calcResult, setCalcResult] = useState<PayrollCalculation | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { data: summary } = useQuery({
    queryKey: ["hr-payroll-summary", branchId, summaryYear],
    queryFn: () => getPayrollSummary(branchId, summaryYear),
    enabled: !!branchId,
  });

  const { data: staffList = [] } = useQuery({
    queryKey: ["hr-staff", branchId, "active"],
    queryFn: () => listStaff(branchId, "active"),
    enabled: !!branchId,
  });

  const calcMutation = useMutation({
    mutationFn: () => calculatePayroll({
      employment_type: calcForm.employment_type,
      base_pay: parseInt(calcForm.base_pay || "0"),
      allowance: parseInt(calcForm.allowance || "0"),
      bonus: parseInt(calcForm.bonus || "0"),
      work_hours: calcForm.work_hours ? parseFloat(calcForm.work_hours) : undefined,
      hourly_wage: calcForm.hourly_wage ? parseInt(calcForm.hourly_wage) : undefined,
    }),
    onSuccess: (data) => setCalcResult(data),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!calcForm.staffId) throw new Error("직원을 선택하세요");
      if (!calcResult) throw new Error("먼저 계산을 실행하세요");
      return createPayroll(calcForm.staffId, {
        year: parseInt(calcForm.year),
        month: parseInt(calcForm.month),
        base_pay: parseInt(calcForm.base_pay || "0"),
        allowance: parseInt(calcForm.allowance || "0"),
        bonus: parseInt(calcForm.bonus || "0"),
        work_hours: calcForm.work_hours ? parseFloat(calcForm.work_hours) : undefined,
        status: "draft",
      });
    },
    onSuccess: () => {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  const isHourly = calcForm.employment_type === "parttime";
  const isFreelancer = calcForm.employment_type === "freelancer";

  const barMax = summary ? Math.max(...summary.monthly.map(m => m.total_cost), 1) : 1;

  return (
    <div className="flex-1 overflow-y-auto bg-muted/30">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* 헤더 */}
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-brand/10">
            <BanknoteIcon className="size-5 text-brand" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">급여 명세</h1>
            <p className="text-xs text-muted-foreground">4대보험 자동 계산 · 월별 인건비 현황</p>
          </div>
        </div>

        {/* 연도별 인건비 요약 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">월별 인건비 현황</span>
            </div>
            <Select value={String(summaryYear)} onChange={e => setSummaryYear(parseInt(e.target.value))}
              className="w-28 h-8 text-xs">
              {[currentYear, currentYear - 1, currentYear - 2].map(y => (
                <option key={y} value={String(y)}>{y}년</option>
              ))}
            </Select>
          </div>

          {summary ? (
            <Card>
              <CardContent className="pt-5">
                {summary.monthly.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">급여 데이터가 없습니다</p>
                ) : (
                  <>
                    {/* 막대 그래프 */}
                    <div className="flex items-end gap-1.5 h-32 mb-3">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(m => {
                        const mData = summary.monthly.find(d => d.month === m);
                        const height = mData ? (mData.total_cost / barMax) * 100 : 0;
                        return (
                          <div key={m} className="flex-1 flex flex-col items-center gap-1">
                            <div className="w-full flex flex-col justify-end" style={{ height: "100px" }}>
                              <div
                                className={cn("w-full rounded-sm transition-all", mData ? "bg-brand/60" : "bg-muted")}
                                style={{ height: `${Math.max(height, mData ? 4 : 2)}px` }}
                                title={mData ? formatKRW(mData.total_cost) : "데이터 없음"}
                              />
                            </div>
                            <span className="text-[9px] text-muted-foreground">{m}월</span>
                          </div>
                        );
                      })}
                    </div>
                    {/* 연간 합계 */}
                    <div className="grid grid-cols-3 gap-4 pt-3 border-t border-border text-center">
                      <div>
                        <p className="text-xs text-muted-foreground">연간 총 인건비</p>
                        <p className="text-lg font-bold text-foreground">{formatKRW(summary.annual_total)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">월 평균</p>
                        <p className="text-lg font-bold text-foreground">
                          {formatKRW(summary.monthly.length > 0 ? Math.round(summary.annual_total / summary.monthly.length) : 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">기록된 월 수</p>
                        <p className="text-lg font-bold text-foreground">{summary.monthly.length}개월</p>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="h-36 flex items-center justify-center text-muted-foreground text-sm">
              불러오는 중…
            </Card>
          )}
        </div>

        {/* 급여 계산기 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Calculator className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">급여 계산기</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 입력 패널 */}
            <Card>
              <CardContent className="pt-5 space-y-4">
                {/* 직원 / 년월 */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label>직원 선택</Label>
                    <Select value={calcForm.staffId} onChange={e => {
                      const v = e.target.value;
                      const s = staffList.find(s => s.id === v);
                      setCalcForm(f => ({
                        ...f, staffId: v,
                        employment_type: s?.employment_type ?? "regular",
                        base_pay: s?.base_salary ? String(s.base_salary) : "",
                        hourly_wage: s?.hourly_wage ? String(s.hourly_wage) : "",
                      }));
                    }}>
                      <option value="">직원을 선택하세요</option>
                      {staffList.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({EMPLOYMENT_TYPE_LABELS[s.employment_type]})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>년도</Label>
                    <Input type="number" value={calcForm.year} onChange={e => setCalcForm(f => ({ ...f, year: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>월</Label>
                    <Select value={calcForm.month} onChange={e => setCalcForm(f => ({ ...f, month: e.target.value }))}>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                        <option key={m} value={String(m)}>{m}월</option>
                      ))}
                    </Select>
                  </div>
                </div>

                {/* 고용 형태 */}
                <div className="space-y-1.5">
                  <Label>고용 형태</Label>
                  <Select value={calcForm.employment_type} onChange={e => setCalcForm(f => ({ ...f, employment_type: e.target.value as EmploymentType }))}>
                    {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </Select>
                </div>

                {/* 급여 입력 */}
                {!isHourly ? (
                  <div className="space-y-1.5">
                    <Label>기본급 (원)</Label>
                    <Input type="number" placeholder="3000000" value={calcForm.base_pay}
                      onChange={e => setCalcForm(f => ({ ...f, base_pay: e.target.value }))} />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>시급 (원)</Label>
                      <Input type="number" placeholder="12000" value={calcForm.hourly_wage}
                        onChange={e => setCalcForm(f => ({ ...f, hourly_wage: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>실근무 시간</Label>
                      <Input type="number" placeholder="87" value={calcForm.work_hours}
                        onChange={e => setCalcForm(f => ({ ...f, work_hours: e.target.value }))} />
                    </div>
                  </div>
                )}

                {/* 수당/상여 */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>수당 (원)</Label>
                    <Input type="number" placeholder="0" value={calcForm.allowance}
                      onChange={e => setCalcForm(f => ({ ...f, allowance: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>상여 (원)</Label>
                    <Input type="number" placeholder="0" value={calcForm.bonus}
                      onChange={e => setCalcForm(f => ({ ...f, bonus: e.target.value }))} />
                  </div>
                </div>

                <Button
                  className="w-full gap-2"
                  onClick={() => calcMutation.mutate()}
                  disabled={(!calcForm.base_pay && !calcForm.hourly_wage) || calcMutation.isPending}
                >
                  <Calculator className="size-4" />
                  {calcMutation.isPending ? "계산 중…" : "급여 계산하기"}
                </Button>
              </CardContent>
            </Card>

            {/* 결과 패널 */}
            <Card>
              <CardContent className="pt-5">
                {!calcResult ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3 py-12">
                    <Calculator className="size-10 opacity-30" />
                    <p className="text-sm">좌측에서 급여 정보를 입력 후<br />계산하기 버튼을 누르세요</p>
                    {/* 요율 안내 */}
                    <button
                      onClick={() => setShowDetail(!showDetail)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2"
                    >
                      <Info className="size-3.5" /> 4대보험 요율 안내
                      {showDetail ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                    </button>
                    {showDetail && (
                      <div className="w-full text-xs border border-border rounded-lg overflow-hidden">
                        <div className="grid grid-cols-3 bg-muted px-3 py-1.5 font-semibold text-muted-foreground">
                          <span>항목</span><span className="text-center">근로자</span><span className="text-center">사업주</span>
                        </div>
                        {INSURANCE_RATES.map(r => (
                          <div key={r.label} className="grid grid-cols-3 px-3 py-1.5 border-t border-border text-foreground">
                            <span>{r.label}</span>
                            <span className="text-center">{r.employee}</span>
                            <span className="text-center">{r.employer}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* 핵심 요약 */}
                    <div className="rounded-xl bg-brand/5 border border-brand/20 p-4 text-center">
                      <p className="text-xs text-muted-foreground mb-1">실수령액</p>
                      <p className="text-3xl font-black text-brand">{formatKRW(calcResult.net_pay)}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        지급액 {formatKRW(calcResult.gross_pay)} — 공제 {formatKRW(calcResult.total_deduction)}
                      </p>
                    </div>

                    {/* 공제 내역 */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">근로자 공제</p>
                      {isFreelancer ? (
                        <Row label="원천징수 (3.3%)" value={calcResult.withholding_tax} accent />
                      ) : (
                        <>
                          <Row label="국민연금 (4.5%)" value={calcResult.national_pension} />
                          <Row label="건강보험 (3.545%)" value={calcResult.health_insurance} />
                          <Row label="장기요양" value={calcResult.long_term_care} />
                          <Row label="고용보험 (0.9%)" value={calcResult.employment_insurance} />
                          <Row label="소득세 + 지방소득세" value={calcResult.income_tax + calcResult.local_income_tax} />
                          <Row label="공제 합계" value={calcResult.total_deduction} accent />
                        </>
                      )}
                    </div>

                    {/* 사업주 부담 */}
                    {!isFreelancer && (
                      <div className="space-y-1.5 pt-3 border-t border-border">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">사업주 추가 부담</p>
                        <Row label="국민연금 (4.5%)" value={calcResult.employer_pension} />
                        <Row label="건강보험 (3.545%)" value={calcResult.employer_health} />
                        <Row label="장기요양" value={calcResult.employer_long_term_care} />
                        <Row label="고용보험 (1.15%)" value={calcResult.employer_employment} />
                        <Row label="산재보험 (~1%)" value={calcResult.employer_accident} />
                        <Row label="사업주 부담 합계" value={calcResult.employer_total} accent />
                        <div className="mt-2 pt-2 border-t border-border">
                          <Row label="💰 총 인건비 (회사 실부담)" value={calcResult.gross_pay + calcResult.employer_total} bold />
                        </div>
                      </div>
                    )}

                    {/* 저장 버튼 */}
                    {calcForm.staffId && (
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => saveMutation.mutate()}
                        disabled={saveMutation.isPending}
                      >
                        {saveMutation.isPending ? "저장 중…" : saveSuccess ? "✓ 저장됨" : "급여 명세 저장"}
                      </Button>
                    )}
                    {saveMutation.error && (
                      <p className="text-xs text-danger">{(saveMutation.error as Error).message}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, accent, bold }: { label: string; value: number; accent?: boolean; bold?: boolean }) {
  return (
    <div className={cn("flex justify-between items-center py-1", accent && "border-t border-border mt-1 pt-2")}>
      <span className={cn("text-xs", bold ? "font-bold text-foreground" : accent ? "font-semibold text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
      <span className={cn("text-xs font-semibold tabular-nums", accent ? "text-danger" : bold ? "text-brand" : "text-foreground")}>
        {formatKRW(value)}
      </span>
    </div>
  );
}

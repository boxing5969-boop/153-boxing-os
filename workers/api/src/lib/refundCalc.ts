// ─────────────────────────────────────────────────────────────
// 환불 자동 계산 — 순수 계산/문구 엔진 (153-branch-report RefundCalculator 와 동일 공식)
// 공식: 사용분 일할/회차 공제, 위약금(소비자=차감/센터=가산), 장비·부대 공제,
//       음수→0, 카드수수료 미차감, 기본 1,000원 회원유리 올림.
// ⚠ 변경 시 153-branch-report/src/lib/refundCalc.ts 와 동기화할 것(같은 공식이어야 함).
// ─────────────────────────────────────────────────────────────
export type ContractType = "기간권" | "회차권" | "혼합권";
export type RefundReason = "소비자" | "센터" | "기타";
export type PayMethod = "카드" | "현금" | "계좌이체" | "기타";
export type RoundingType = "none" | "ten" | "hundred" | "thousand_up";

export interface RefundInput {
  member_name: string;
  phone: string;
  branch_name: string;
  product_name: string;
  contract_type: ContractType;
  refund_reason: RefundReason;
  payment_date: string;
  start_date: string;
  end_date: string;
  refund_requested_date: string;
  payment_amount: number;
  tuition_amount: number;
  penalty_applied: boolean;
  penalty_rate: number;
  pay_method: PayMethod;
  total_sessions: number;
  used_sessions: number;
  glove_given: boolean;
  wrap_given: boolean;
  equipment_fee: number;
  equipment_notice_given: boolean;
  equipment_used: boolean;
  equipment_hygiene_unreusable: boolean;
  equipment_returned: boolean;
  locker_included: boolean;
  sportswear_included: boolean;
  paid_separately: boolean;
  non_refundable_notice: boolean;
  additional_amount: number;
  additional_excluded: boolean;
  rounding_type: RoundingType;
}

export interface RiskItem {
  level: "주의" | "위험";
  msg: string;
}
export interface RefundResult {
  beforeStart: boolean;
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  totalSessions: number;
  usedSessions: number;
  remainingSessions: number;
  usedAmount: number;
  penaltyAmount: number;
  equipmentDeduct: number;
  equipmentDeductible: boolean;
  additionalDeduct: number;
  calculated: number;
  final: number;
  risks: RiskItem[];
  riskLevel: "안전" | "주의" | "위험";
}

export function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function dayDiff(a: string, b: string): number {
  if (!a || !b) return 0;
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}
function businessDaysBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  let n = 0;
  while (d.getTime() < end.getTime()) {
    d = new Date(d.getTime() + 86400000);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}
export function applyRounding(x: number, type: RoundingType): number {
  if (type === "ten") return Math.round(x / 10) * 10;
  if (type === "hundred") return Math.round(x / 100) * 100;
  if (type === "thousand_up") return Math.ceil(x / 1000) * 1000;
  return Math.round(x);
}
export function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

export function calcRefund(i: RefundInput, today: string = todayKst()): RefundResult {
  const tuition = Math.max(0, i.tuition_amount || 0);
  const beforeStart = dayDiff(i.refund_requested_date, i.start_date) <= 0;

  const totalDays = Math.max(0, dayDiff(i.end_date, i.start_date));
  const elapsedDays = Math.max(0, Math.min(totalDays, dayDiff(i.refund_requested_date, i.start_date)));
  const remainingDays = Math.max(0, totalDays - elapsedDays);

  const totalSessions = Math.max(0, i.total_sessions || 0);
  const usedSessions = Math.max(0, i.used_sessions || 0);
  const remainingSessions = Math.max(0, totalSessions - usedSessions);

  let usedAmount = 0;
  if (!beforeStart) {
    if (i.contract_type === "회차권") {
      usedAmount = totalSessions > 0 ? Math.round((tuition * usedSessions) / totalSessions) : 0;
    } else {
      usedAmount = totalDays > 0 ? Math.round((tuition * elapsedDays) / totalDays) : 0;
    }
  }

  const penaltyAmount = i.penalty_applied ? Math.round(tuition * (i.penalty_rate || 0)) : 0;

  const equipmentGiven = i.glove_given || i.wrap_given;
  const equipmentDeductible =
    i.equipment_notice_given &&
    equipmentGiven &&
    (i.equipment_used || !i.equipment_returned) &&
    i.equipment_hygiene_unreusable;
  const equipmentDeduct = equipmentDeductible ? Math.max(0, i.equipment_fee || 0) : 0;

  const additionalDeduct =
    i.additional_excluded && i.paid_separately && i.non_refundable_notice
      ? Math.max(0, i.additional_amount || 0)
      : 0;

  let calculated: number;
  if (i.refund_reason === "센터") {
    calculated = beforeStart ? tuition + penaltyAmount : tuition - usedAmount + penaltyAmount;
  } else {
    calculated = beforeStart
      ? tuition - penaltyAmount - equipmentDeduct - additionalDeduct
      : tuition - usedAmount - penaltyAmount - equipmentDeduct - additionalDeduct;
  }
  const calcClamped = Math.max(0, Math.round(calculated));
  const final = Math.max(0, applyRounding(calcClamped, i.rounding_type));

  const risks: RiskItem[] = [];
  if (equipmentGiven && !i.equipment_notice_given)
    risks.push({ level: "주의", msg: "장비료 사전 고지 미확인 — 차감하려면 회원 동의가 필요합니다." });
  if (equipmentGiven && !i.equipment_used && i.equipment_returned)
    risks.push({ level: "주의", msg: "장비 미사용·반납 — 장비료 차감 근거가 약합니다." });
  if ((i.locker_included || i.sportswear_included) && !i.non_refundable_notice)
    risks.push({ level: "주의", msg: "락카/운동복 환불불가 사전 고지 미확인 — 환불 제외는 분쟁 위험이 있습니다." });
  if ((i.locker_included || i.sportswear_included) && !i.paid_separately)
    risks.push({ level: "주의", msg: "수강료와 부대서비스 금액 구분 없음 — 환불 제외를 단정하지 말고 관리자 확인이 필요합니다." });
  if (businessDaysBetween(i.refund_requested_date, today) > 3)
    risks.push({ level: "위험", msg: "환불 접수 후 3영업일 초과 — 지연이자 발생 가능성, 즉시 처리하세요." });
  if (i.refund_reason === "기타")
    risks.push({ level: "주의", msg: "환불 사유 '기타' — 소비자 사정 기준으로 계산됨, 사유 명확화 필요." });

  const riskLevel = risks.some((r) => r.level === "위험")
    ? "위험"
    : risks.some((r) => r.level === "주의")
      ? "주의"
      : "안전";

  return {
    beforeStart,
    totalDays,
    elapsedDays,
    remainingDays,
    totalSessions,
    usedSessions,
    remainingSessions,
    usedAmount,
    penaltyAmount,
    equipmentDeduct,
    equipmentDeductible,
    additionalDeduct,
    calculated: calcClamped,
    final,
    risks,
    riskLevel,
  };
}

export function buildMemberMessage(i: RefundInput, r: RefundResult): string {
  const lines: string[] = [
    `안녕하세요, ${i.branch_name || "153복싱짐"}입니다.`,
    `요청하신 중도해지 환불금 산정 안내드립니다.`,
    ``,
    `· 상품: ${i.product_name}${i.start_date ? ` (${i.start_date} 시작${i.end_date ? ` ~ ${i.end_date} 종료` : ""})` : ""}`,
    `· 수강료: ${won(i.tuition_amount)}`,
  ];
  if (r.usedAmount > 0) lines.push(`· 이용기간 공제: ${won(r.usedAmount)}`);
  if (r.penaltyAmount > 0) {
    lines.push(
      i.refund_reason === "센터"
        ? `· 센터 사정 보상 가산 ${Math.round(i.penalty_rate * 100)}%: +${won(r.penaltyAmount)}`
        : `· 중도해지 위약금 ${Math.round(i.penalty_rate * 100)}%: ${won(r.penaltyAmount)}`
    );
  }
  if (r.equipmentDeduct > 0) lines.push(`· 개인 위생 장비(글러브·붕대) 장비료: ${won(r.equipmentDeduct)}`);
  if (r.additionalDeduct > 0) lines.push(`· 부대서비스(환불 제외): ${won(r.additionalDeduct)}`);
  lines.push(
    ``,
    `산정 환불금은 ${won(r.calculated)}이며,`,
    `원활한 처리를 위해 최종 ${won(r.final)}으로 환불 진행드리겠습니다.`
  );
  if (i.pay_method === "카드") {
    lines.push(``, `카드 결제 건은 카드 부분취소로 우선 진행되며, 카드사 반영까지 영업일 기준 며칠 소요될 수 있습니다.`);
  }
  return lines.join("\n");
}

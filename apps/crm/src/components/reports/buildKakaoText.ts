import type { DailyReportFields, ReportSummary } from "@/services/dailyReports";

function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

/**
 * 카톡 공유용 리포트 텍스트 생성.
 * 섹션: [Target & Gap] / [Sales] / [Sales Pipeline] / [Field & Coaching] / [Retention & System] / [Decision]
 * 빈 항목(메모 미입력)은 자동 생략. 섹션 구분 빈 줄은 유지.
 */
export function buildKakaoText(opts: {
  branchName: string;
  date: string;
  report: DailyReportFields;
  summary: ReportSummary;
}): string {
  const { branchName, date, report, summary } = opts;
  const dayTotal =
    report.revenue_pt + report.revenue_membership + report.revenue_goods + report.revenue_dan;
  const achievement =
    summary.achievement != null ? `${Math.round(summary.achievement * 100)}%` : "목표 미설정";

  const lines: (string | null)[] = [
    `📊 ${branchName} 일일 경영 리포트 (${date})`,
    "",
    "[Target & Gap]",
    `· 월목표 ${won(summary.target_amount)} / 누적 ${won(summary.month_cumulative)}`,
    `· 달성률 ${achievement} · Gap ${won(summary.gap)} · D-${summary.d_day}`,
    "",
    `[Sales] 당일 ${won(dayTotal)}`,
    `· PT ${won(report.revenue_pt)} / 수강 ${won(report.revenue_membership)} / 물품 ${won(report.revenue_goods)} / 단증 ${won(report.revenue_dan)}`,
    "",
    "[Sales Pipeline]",
    `· 문의 ${report.inquiry_count} / 신규 ${report.new_signups} / 재등록 ${report.re_signups} / 보류 ${report.pending_count}`,
    report.pipeline_action_plan ? `· 액션: ${report.pipeline_action_plan}` : null,
    "",
    "[Field & Coaching]",
    `· 출석 오전 ${report.morning_attendance} / 점심 ${report.lunch_attendance} / 저녁 ${report.evening_attendance}`,
    report.morning_note ? `· 오전: ${report.morning_note}` : null,
    report.lunch_note ? `· 점심: ${report.lunch_note}` : null,
    report.evening_note ? `· 저녁: ${report.evening_note}` : null,
    "",
    "[Retention & System]",
    `· 비활성 연락 ${report.inactive_contacted} → 성공 ${report.inactive_reached} → 복귀 ${report.inactive_returned}`,
    report.promotion_candidates ? `· 승급대상: ${report.promotion_candidates}` : null,
    report.facility_issue ? `· 시설이슈: ${report.facility_issue}` : null,
    "",
    "[Decision]",
    report.decision_issue ? `· 이슈: ${report.decision_issue}` : null,
    report.decision_proposal ? `· 제안: ${report.decision_proposal}` : null,
    report.decision_request ? `· 요청: ${report.decision_request}` : null,
  ];

  return lines.filter((l): l is string => l !== null).join("\n");
}

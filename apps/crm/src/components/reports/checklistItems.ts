import type { ChecklistItem } from "@/services/dailyReports";

/**
 * 일일 오픈 체크리스트 1차 표준안 (9항목: 시설점검 4 + CRM 2 + 마케팅·보고 3).
 * ⚠️ 임시 문구 — 지점에서 쓰던 실제 항목으로 교체 필요. 추후 지점별 편집 가능 구조로 확장 예정.
 */
export const DEFAULT_CHECKLIST_LABELS: readonly string[] = [
  // 시설점검 4
  "샌드백·글러브·링/매트 상태 점검",
  "정수기·화장실·샤워실 청결 확인",
  "냉난방·환기·조명 정상 작동",
  "CCTV·출입 장비 정상 작동",
  // CRM 2
  "전일 신규/체험 회원 CRM 등록 확인",
  "만료 예정 회원 연락 처리",
  // 마케팅/보고 3
  "SNS/블로그 콘텐츠 1건 게시",
  "리뷰·문의 응대 완료",
  "전일 일일 리포트 작성·보고 완료",
];

export function defaultChecklistItems(): ChecklistItem[] {
  return DEFAULT_CHECKLIST_LABELS.map((label, i) => ({ no: i + 1, label, done: false, memo: "" }));
}

/** 저장된 items 가 있으면 라벨 기준으로 표준안과 머지(항목 추가/문구 변경에 견고). */
export function mergeChecklist(saved: ChecklistItem[] | null | undefined): ChecklistItem[] {
  if (!saved || saved.length === 0) return defaultChecklistItems();
  return saved.map((it, i) => ({
    no: it.no ?? i + 1,
    label: it.label,
    done: !!it.done,
    memo: it.memo ?? "",
  }));
}

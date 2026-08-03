import {
  LayoutDashboard,
  Users,
  CreditCard,
  ScrollText,
  Smartphone,
  UserCheck,
  Building2,
  Trophy,
  Settings,
  ShieldCheck,
  KeyRound,
  Bell,
  HelpCircle,
  Receipt,
  Tablet,
  Wallet,
  MessageSquare,
  SendHorizontal,
  Clock,
  FileText,
  UserCog,
  FileSignature,
  BanknoteIcon,
  CalendarDays,
  BarChart3,
  ClipboardList,
  SmilePlus,
  Inbox,
  TrendingUp,
  Gift,
  ScanFace,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@153/shared";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: UserRole[];
  badge?: number;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// ── 역할 묶음 (업그레이드 키트 v2 / 04_TARGET_IA · 06 인수기준 기준) ──
const HQ: UserRole[] = ["super_admin", "hq_admin"]; // 본사
const HQ_OWNER: UserRole[] = ["super_admin", "hq_admin", "owner"];
// 회원·리포트 등 운영진+본사 공통 관리 항목
const BRANCH_AND_HQ: UserRole[] = ["super_admin", "hq_admin", "branch_owner", "branch_manager"];
// 매장운영: 운영 주체(대표/관장). 순수 본사(hq_admin)·코치는 상위 노출 제외
const OPS_ROLES: UserRole[] = ["super_admin", "branch_owner", "branch_manager"];
// 고객케어(FC): 운영 + 상담직원 + 코치. 순수 본사(hq_admin) 제외
const CARE_ROLES: UserRole[] = [
  "super_admin",
  "branch_owner",
  "branch_manager",
  "owner",
  "brand_manager",
  "staff",
  "coach",
];
// 문자 발송 도구: 운영 주체 (코치는 케어 내 추천문자 검토만)
const MSG_ROLES: UserRole[] = ["super_admin", "branch_owner", "branch_manager"];
// 회원 내 체험·상담/만족도 등 코치 포함 항목
const COACH_VISIBLE: UserRole[] = ["super_admin", "branch_owner", "branch_manager", "coach"];

// ── 단일 네비게이션 소스 (Sidebar · MobileNav 공용) ──
// 경로(route)는 변경하지 않는다 → 기존 URL·즐겨찾기 100% 보존.
// 권한 없는 항목은 숨김(미렌더), 빈 그룹은 자동 숨김.
// 역할별 상위 메뉴:
//   관장(branch_owner/manager): 홈·회원·고객케어·매장운영·리포트 (+설정)
//   코치(coach):               홈·회원·고객케어·수업 (+설정)
//   본사(hq_admin):            홈·회원·리포트·지점관리·본사관리 (+설정)
//   대표(super_admin):         전체 (운영+본사) — 마스터 권한 유지
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "홈",
    items: [
      { to: "/", label: "홈", icon: LayoutDashboard },
      { to: "/coach", label: "내 업무", icon: ClipboardList, roles: ["coach"] },
    ],
  },
  {
    label: "회원",
    items: [
      { to: "/members", label: "회원 · 명단", icon: Users },
      { to: "/memberships", label: "이용권 · 결제", icon: CreditCard, roles: BRANCH_AND_HQ },
      { to: "/visitors", label: "체험 · 상담", icon: UserCheck, roles: COACH_VISIBLE },
      { to: "/levels", label: "레벨 · 승급", icon: Trophy },
    ],
  },
  {
    label: "고객케어",
    items: [
      { to: "/fc/tasks", label: "오늘의 회원 케어", icon: Inbox, roles: CARE_ROLES },
      { to: "/fc/revenue-board", label: "재등록 · 상담", icon: TrendingUp, roles: CARE_ROLES },
      { to: "/surveys", label: "만족도 · 후속관리", icon: SmilePlus, roles: COACH_VISIBLE },
      { to: "/admin/vip-invitations", label: "VIP 초대장", icon: Gift, roles: BRANCH_AND_HQ },
      { to: "/admin/bulk-notify", label: "문자 보내기", icon: SendHorizontal, roles: MSG_ROLES },
      { to: "/admin/scheduled-msgs", label: "예약 문자", icon: Clock, roles: MSG_ROLES },
      { to: "/admin/msg-templates", label: "문자 템플릿", icon: FileText, roles: MSG_ROLES },
      { to: "/admin/send-logs", label: "발송 이력", icon: MessageSquare, roles: MSG_ROLES },
    ],
  },
  {
    // 코치 전용 상위 메뉴. 관장/대표는 아래 매장운영 안에서 본다.
    label: "수업",
    items: [
      { to: "/classes", label: "수업 일정", icon: CalendarDays, roles: ["coach"] },
    ],
  },
  {
    label: "매장운영",
    items: [
      { to: "/access-logs", label: "출입 현황", icon: ScrollText, roles: OPS_ROLES },
      { to: "/face-attendance", label: "얼굴 출석", icon: ScanFace, roles: BRANCH_AND_HQ },
      { to: "/devices", label: "장비 상태", icon: Smartphone, roles: OPS_ROLES },
      { to: "/classes", label: "수업 일정", icon: CalendarDays, roles: OPS_ROLES },
      { to: "/finance", label: "매출 · 지출", icon: Wallet, roles: OPS_ROLES },
      { to: "/admin/revenue", label: "매출 상세", icon: Receipt, roles: OPS_ROLES },
      { to: "/kiosk", label: "키오스크", icon: Tablet, roles: OPS_ROLES },
      { to: "/hr/staff", label: "직원 관리", icon: UserCog, roles: OPS_ROLES },
      { to: "/hr/contracts", label: "계약서", icon: FileSignature, roles: OPS_ROLES },
      { to: "/hr/payroll", label: "급여 명세", icon: BanknoteIcon, roles: OPS_ROLES },
      { to: "/admin/alerts", label: "알림", icon: Bell, roles: OPS_ROLES },
    ],
  },
  {
    label: "리포트",
    items: [
      { to: "/reports/daily", label: "일일 리포트", icon: ClipboardList, roles: BRANCH_AND_HQ },
      { to: "/kpi", label: "핵심 지표", icon: BarChart3, roles: BRANCH_AND_HQ },
      { to: "/reports/daily/view", label: "지점 리포트", icon: FileText, roles: HQ },
    ],
  },
  {
    label: "지점관리",
    items: [
      { to: "/hq", label: "지점 현황", icon: BarChart3, roles: HQ },
      { to: "/branches", label: "지점 관리", icon: Building2, roles: HQ },
    ],
  },
  {
    label: "본사관리",
    items: [
      { to: "/admin/approvals", label: "가입 승인", icon: UserCheck, roles: HQ },
      { to: "/staff/roles", label: "직원 권한", icon: ShieldCheck, roles: HQ_OWNER },
      { to: "/staff", label: "CRM 직원", icon: UserCog, roles: HQ },
    ],
  },
  {
    label: "설정",
    items: [
      { to: "/settings/profile", label: "내 프로필 · 비밀번호", icon: Settings },
      { to: "/admin/emergency-pins", label: "비상 PIN", icon: KeyRound, roles: BRANCH_AND_HQ },
      { to: "/help", label: "도움말", icon: HelpCircle },
    ],
  },
];

// 역할로 필터링된 그룹(빈 그룹 제거). Sidebar·MobileNav 공용.
export function filterNavGroups(role: UserRole | undefined): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.roles || (role != null && item.roles.includes(role))
    ),
  })).filter((group) => group.items.length > 0);
}

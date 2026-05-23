/**
 * 모바일 전용 "더보기" 페이지 (/more).
 * 하단 탭바에 들어가지 않은 메뉴들을 iOS 설정앱 스타일로 그룹핑.
 * 데스크톱에서는 사이드바가 같은 메뉴를 보여주므로 이 화면을 거의 안 쓰지만,
 * 직접 URL 진입 시에도 정상 렌더되도록 둠.
 */
import { Link } from "react-router-dom";
import {
  CreditCard,
  UserCheck,
  Smartphone,
  KeyRound,
  Trophy,
  Wallet,
  Receipt,
  Tablet,
  Building2,
  ShieldCheck,
  Bell,
  SendHorizontal,
  Clock,
  FileText,
  MessageSquare,
  UserCog,
  FileSignature,
  BanknoteIcon,
  BarChart3,
  Inbox,
  TrendingUp,
  ClipboardList,
  SmilePlus,
  HelpCircle,
  Settings,
  LogOut,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";
import type { UserRole } from "@153/shared";

interface MenuItem {
  to?: string;
  label: string;
  icon: LucideIcon;
  roles?: UserRole[];
  iconBg?: string;
  iconColor?: string;
  /** action 으로 처리할 때 (예: 로그아웃) */
  onClick?: () => void;
}

interface MenuGroup {
  label: string;
  items: MenuItem[];
}

const BRANCH_AND_HQ: UserRole[] = [
  "super_admin",
  "hq_admin",
  "branch_owner",
  "branch_manager",
];

const FC_ROLES: UserRole[] = [
  ...BRANCH_AND_HQ,
  "owner",
  "brand_manager",
  "staff",
  "coach",
];

function buildGroups(signOut: () => void): MenuGroup[] {
  return [
    {
      label: "내 업무",
      items: [
        { to: "/coach", label: "업무보드", icon: ClipboardList, roles: ["coach"], iconBg: "bg-blue-100", iconColor: "text-blue-600" },
        { to: "/fc/tasks", label: "FC 업무함", icon: Inbox, roles: FC_ROLES, iconBg: "bg-purple-100", iconColor: "text-purple-600" },
        { to: "/fc/revenue-board", label: "매출 기회 보드", icon: TrendingUp, roles: FC_ROLES, iconBg: "bg-emerald-100", iconColor: "text-emerald-600" },
      ],
    },
    {
      label: "운영",
      items: [
        { to: "/kpi", label: "KPI 대시보드", icon: BarChart3, roles: BRANCH_AND_HQ, iconBg: "bg-indigo-100", iconColor: "text-indigo-600" },
        { to: "/staff/roles", label: "역할 배정", icon: ShieldCheck, roles: ["super_admin", "hq_admin", "owner"], iconBg: "bg-amber-100", iconColor: "text-amber-700" },
        { to: "/memberships", label: "이용권", icon: CreditCard, roles: BRANCH_AND_HQ, iconBg: "bg-green-100", iconColor: "text-green-600" },
        { to: "/visitors", label: "방문자", icon: UserCheck, roles: BRANCH_AND_HQ, iconBg: "bg-cyan-100", iconColor: "text-cyan-600" },
      ],
    },
    {
      label: "출입 관리",
      items: [
        { to: "/devices", label: "장비", icon: Smartphone, roles: BRANCH_AND_HQ, iconBg: "bg-slate-100", iconColor: "text-slate-600" },
        { to: "/admin/emergency-pins", label: "비상 PIN", icon: KeyRound, roles: BRANCH_AND_HQ, iconBg: "bg-orange-100", iconColor: "text-orange-600" },
      ],
    },
    {
      label: "성과",
      items: [
        { to: "/surveys", label: "회원만족", icon: SmilePlus, roles: BRANCH_AND_HQ, iconBg: "bg-pink-100", iconColor: "text-pink-600" },
        { to: "/levels", label: "레벨", icon: Trophy, iconBg: "bg-yellow-100", iconColor: "text-yellow-700" },
        { to: "/finance", label: "수익/지출", icon: Wallet, roles: BRANCH_AND_HQ, iconBg: "bg-emerald-100", iconColor: "text-emerald-600" },
        { to: "/admin/revenue", label: "매출 상세", icon: Receipt, roles: BRANCH_AND_HQ, iconBg: "bg-green-100", iconColor: "text-green-600" },
        { to: "/kiosk", label: "키오스크", icon: Tablet, roles: BRANCH_AND_HQ, iconBg: "bg-stone-100", iconColor: "text-stone-600" },
      ],
    },
    {
      label: "인사/급여",
      items: [
        { to: "/hr/staff", label: "직원 관리", icon: UserCog, roles: BRANCH_AND_HQ, iconBg: "bg-blue-100", iconColor: "text-blue-600" },
        { to: "/hr/contracts", label: "계약서", icon: FileSignature, roles: BRANCH_AND_HQ, iconBg: "bg-slate-100", iconColor: "text-slate-600" },
        { to: "/hr/payroll", label: "급여 명세", icon: BanknoteIcon, roles: BRANCH_AND_HQ, iconBg: "bg-emerald-100", iconColor: "text-emerald-600" },
      ],
    },
    {
      label: "본사 관리",
      items: [
        { to: "/hq", label: "본사 현황", icon: BarChart3, roles: ["super_admin", "hq_admin"], iconBg: "bg-indigo-100", iconColor: "text-indigo-600" },
        { to: "/branches", label: "지점", icon: Building2, roles: ["super_admin", "hq_admin"], iconBg: "bg-blue-100", iconColor: "text-blue-600" },
        { to: "/staff", label: "CRM 직원", icon: ShieldCheck, roles: ["super_admin", "hq_admin"], iconBg: "bg-amber-100", iconColor: "text-amber-700" },
      ],
    },
    {
      label: "알림 / 메시지",
      items: [
        { to: "/admin/alerts", label: "알림", icon: Bell, roles: BRANCH_AND_HQ, iconBg: "bg-red-100", iconColor: "text-red-600" },
        { to: "/admin/bulk-notify", label: "그룹 발송", icon: SendHorizontal, roles: BRANCH_AND_HQ, iconBg: "bg-yellow-100", iconColor: "text-yellow-700" },
        { to: "/admin/scheduled-msgs", label: "예약 발송", icon: Clock, roles: BRANCH_AND_HQ, iconBg: "bg-purple-100", iconColor: "text-purple-600" },
        { to: "/admin/msg-templates", label: "메시지 템플릿", icon: FileText, roles: BRANCH_AND_HQ, iconBg: "bg-slate-100", iconColor: "text-slate-600" },
        { to: "/admin/send-logs", label: "발송 이력", icon: MessageSquare, roles: BRANCH_AND_HQ, iconBg: "bg-stone-100", iconColor: "text-stone-600" },
      ],
    },
    {
      label: "기타",
      items: [
        { to: "/settings/profile", label: "설정", icon: Settings, iconBg: "bg-gray-100", iconColor: "text-gray-600" },
        { to: "/help", label: "도움말", icon: HelpCircle, iconBg: "bg-gray-100", iconColor: "text-gray-600" },
        { label: "로그아웃", icon: LogOut, onClick: signOut, iconBg: "bg-red-100", iconColor: "text-red-600" },
      ],
    },
  ];
}

function MenuRow({ item }: { item: MenuItem }) {
  const Icon = item.icon;
  const body = (
    <div className="flex items-center gap-3 px-4 py-3 active:bg-muted/60 transition-colors">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          item.iconBg ?? "bg-muted",
        )}
      >
        <Icon className={cn("size-[18px]", item.iconColor ?? "text-foreground")} />
      </div>
      <span className="flex-1 text-[15px] font-medium text-foreground">{item.label}</span>
      <ChevronRight className="size-4 text-muted-foreground/40" />
    </div>
  );

  if (item.onClick) {
    return (
      <button type="button" onClick={item.onClick} className="block w-full text-left">
        {body}
      </button>
    );
  }
  if (item.to) {
    return <Link to={item.to}>{body}</Link>;
  }
  return body;
}

export default function MoreMenuPage() {
  const { profile, signOut } = useAuth();

  const groups = buildGroups(() => void signOut())
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !item.roles ||
          (profile?.role && (item.roles as readonly string[]).includes(profile.role)),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="space-y-5 pb-20">
      {/* iOS Large Title 풍 */}
      <header className="pt-2">
        <h1 className="text-[28px] font-black tracking-tight text-foreground">더보기</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {profile?.name ?? "사용자"} · 전체 메뉴
        </p>
      </header>

      {groups.map((group) => (
        <section key={group.label}>
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
            {group.label}
          </p>
          <div className="overflow-hidden rounded-2xl border border-border bg-card divide-y divide-border/60">
            {group.items.map((item, i) => (
              <MenuRow key={`${item.to ?? item.label}-${i}`} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

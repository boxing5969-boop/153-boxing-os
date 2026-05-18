import { NavLink } from "react-router-dom";
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
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";
import type { UserRole } from "@153/shared";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: UserRole[];
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const BRANCH_AND_HQ: UserRole[] = [
  "super_admin",
  "hq_admin",
  "branch_owner",
  "branch_manager",
];

const NAV_GROUPS: NavGroup[] = [
  {
    label: "운영",
    items: [
      { to: "/", label: "대시보드", icon: LayoutDashboard },
      { to: "/members", label: "회원", icon: Users },
      { to: "/memberships", label: "이용권", icon: CreditCard, roles: BRANCH_AND_HQ },
      { to: "/visitors", label: "방문자", icon: UserCheck, roles: BRANCH_AND_HQ },
    ],
  },
  {
    label: "출입 관리",
    items: [
      { to: "/access-logs", label: "출입 로그", icon: ScrollText },
      { to: "/devices", label: "장비", icon: Smartphone, roles: BRANCH_AND_HQ },
      { to: "/admin/emergency-pins", label: "비상 PIN", icon: KeyRound, roles: BRANCH_AND_HQ },
    ],
  },
  {
    label: "성과",
    items: [
      { to: "/levels", label: "레벨", icon: Trophy },
      { to: "/finance", label: "수익/지출", icon: Wallet, roles: BRANCH_AND_HQ },
      { to: "/admin/revenue", label: "매출 상세", icon: Receipt, roles: BRANCH_AND_HQ },
      { to: "/kiosk", label: "키오스크", icon: Tablet, roles: BRANCH_AND_HQ },
    ],
  },
  {
    label: "관리",
    items: [
      { to: "/branches", label: "지점", icon: Building2, roles: ["super_admin", "hq_admin"] },
      { to: "/staff", label: "직원", icon: ShieldCheck, roles: ["super_admin", "hq_admin"] },
      { to: "/admin/alerts", label: "알림", icon: Bell, roles: BRANCH_AND_HQ },
      { to: "/settings/profile", label: "설정", icon: Settings },
      { to: "/help", label: "도움말", icon: HelpCircle },
    ],
  },
];

function NavItemLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
          isActive
            ? "bg-sidebar-active text-sidebar-active-foreground shadow-sm"
            : "text-sidebar-foreground/70 hover:bg-sidebar-muted hover:text-sidebar-foreground"
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              "size-4 shrink-0 transition-colors",
              isActive
                ? "text-sidebar-active-foreground"
                : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground"
            )}
          />
          <span className="truncate">{item.label}</span>
          {item.badge != null && item.badge > 0 && (
            <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-brand-foreground px-1">
              {item.badge > 99 ? "99+" : item.badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const { profile } = useAuth();

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.roles || (profile?.role && item.roles.includes(profile.role))
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
      {/* 로고 영역 */}
      <div className="flex h-14 items-center gap-2.5 px-4 border-b border-sidebar-border">
        {/* 복싱 글러브 마크 */}
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand shadow-sm">
          <span className="text-xs font-black text-white leading-none">153</span>
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-xs font-black tracking-widest text-sidebar-foreground uppercase">
            Boxing OS
          </span>
          <span className="text-[10px] text-sidebar-foreground/40 tracking-wide">
            Franchise CRM
          </span>
        </div>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/30">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItemLink key={item.to} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* 하단 버전 표시 */}
      <div className="border-t border-sidebar-border px-4 py-3">
        <p className="text-[10px] text-sidebar-foreground/25 tabular">v1.0.0-beta</p>
      </div>
    </aside>
  );
}

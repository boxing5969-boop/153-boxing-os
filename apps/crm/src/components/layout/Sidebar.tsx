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
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";
import type { UserRole } from "@153/shared";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** undefined = 모든 역할 허용 */
  roles?: UserRole[];
}

const BRANCH_AND_HQ: UserRole[] = [
  "super_admin",
  "hq_admin",
  "branch_owner",
  "branch_manager",
];

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "대시보드", icon: LayoutDashboard },
  { to: "/members", label: "회원", icon: Users },
  { to: "/memberships", label: "이용권", icon: CreditCard, roles: BRANCH_AND_HQ },
  { to: "/access-logs", label: "출입로그", icon: ScrollText },
  { to: "/devices", label: "장비", icon: Smartphone, roles: BRANCH_AND_HQ },
  { to: "/visitors", label: "방문자", icon: UserCheck, roles: BRANCH_AND_HQ },
  { to: "/branches", label: "지점", icon: Building2, roles: ["super_admin", "hq_admin"] },
  { to: "/staff", label: "직원", icon: ShieldCheck, roles: ["super_admin", "hq_admin"] },
  { to: "/admin/emergency-pins", label: "비상 PIN", icon: KeyRound, roles: BRANCH_AND_HQ },
  { to: "/admin/alerts", label: "알림", icon: Bell, roles: BRANCH_AND_HQ },
  { to: "/levels", label: "레벨", icon: Trophy },
  { to: "/settings/profile", label: "설정", icon: Settings },
  { to: "/help", label: "도움말", icon: HelpCircle },
];

export default function Sidebar() {
  const { profile } = useAuth();
  const items = NAV_ITEMS.filter(
    (item) => !item.roles || (profile?.role && item.roles.includes(profile.role))
  );

  return (
    <aside className="w-60 shrink-0 border-r border-foreground/10 bg-muted/30">
      <div className="h-14 flex items-center px-4 border-b border-foreground/10">
        <span className="font-bold tracking-tight">153 BOXING OS</span>
      </div>
      <nav className="p-2 space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-foreground/5"
                )
              }
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}

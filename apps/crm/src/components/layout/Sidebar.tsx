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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** 추후 PR 에서 구현 예정 — 클릭 시 비활성 시각 표시 */
  upcoming?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "대시보드", icon: LayoutDashboard },
  { to: "/members", label: "회원", icon: Users },
  { to: "/memberships", label: "이용권", icon: CreditCard },
  { to: "/access-logs", label: "출입로그", icon: ScrollText, upcoming: true },
  { to: "/devices", label: "장비", icon: Smartphone, upcoming: true },
  { to: "/visitors", label: "방문자", icon: UserCheck, upcoming: true },
  { to: "/branches", label: "지점", icon: Building2, upcoming: true },
  { to: "/levels", label: "레벨", icon: Trophy, upcoming: true },
  { to: "/settings/profile", label: "설정", icon: Settings, upcoming: true },
];

export default function Sidebar() {
  return (
    <aside className="w-60 shrink-0 border-r border-foreground/10 bg-muted/30">
      <div className="h-14 flex items-center px-4 border-b border-foreground/10">
        <span className="font-bold tracking-tight">153 BOXING OS</span>
      </div>
      <nav className="p-2 space-y-1">
        {NAV_ITEMS.map((item) => {
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
                    : "hover:bg-foreground/5",
                  item.upcoming && "opacity-60"
                )
              }
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
              {item.upcoming && (
                <span className="ml-auto rounded bg-foreground/10 px-1.5 py-0.5 text-[10px]">
                  곧
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}

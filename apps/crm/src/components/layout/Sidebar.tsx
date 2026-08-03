import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";
import { filterNavGroups, type NavGroup, type NavItem } from "./navConfig";

// 경로가 이 항목에 속하는가 (/members 는 /memberships 와 혼동되지 않게 경계 처리)
function itemMatches(item: NavItem, pathname: string): boolean {
  if (item.to === "/") return pathname === "/";
  return pathname === item.to || pathname.startsWith(item.to + "/");
}
function groupMatches(group: NavGroup, pathname: string): boolean {
  return group.items.some((i) => itemMatches(i, pathname));
}

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
  const { pathname } = useLocation();
  const groups = filterNavGroups(profile?.role);

  // 접이식: 사용자가 직접 열고 닫은 상태를 기억하고, 이동한 화면이 속한 그룹은 자동으로 연다.
  // 기본은 전부 접힘 — 초심자는 큰 제목 몇 개만 보면 된다.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const active = groups.find((g) => groupMatches(g, pathname));
    if (active) setOpenGroups((prev) => (prev[active.label] ? prev : { ...prev, [active.label]: true }));
    // groups 는 역할 고정 후 안정적 — pathname 변화만 반응하면 충분
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, profile?.role]);

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
      {/* 로고 영역 */}
      <div className="flex h-14 items-center gap-2.5 px-4 border-b border-sidebar-border">
        {/* 복싱 글러브 마크 */}
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand shadow-sm">
          <span className="text-xs font-black text-white leading-none">153</span>
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-xs font-black tracking-widest text-sidebar-foreground uppercase">
            153OS
          </span>
          <span className="text-[10px] text-sidebar-foreground/40 tracking-wide">
            Franchise CRM
          </span>
        </div>
      </div>

      {/* 네비게이션 — 접이식 그룹 */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
        {groups.map((group) => {
          // 항목이 1개뿐인 그룹(홈·수업 등)은 제목 없이 항목만 — 중복 글자 제거
          if (group.items.length === 1 && group.items[0]) {
            return <NavItemLink key={group.label} item={group.items[0]} />;
          }
          const isActive = groupMatches(group, pathname);
          const isOpen = openGroups[group.label] ?? false;
          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => setOpenGroups((prev) => ({ ...prev, [group.label]: !isOpen }))}
                aria-expanded={isOpen}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isActive && !isOpen
                    ? "text-sidebar-active-foreground bg-sidebar-muted"
                    : "text-sidebar-foreground/85 hover:bg-sidebar-muted"
                )}
              >
                <span>{group.label}</span>
                <ChevronDown
                  className={cn(
                    "size-4 text-sidebar-foreground/40 transition-transform",
                    isOpen && "rotate-180"
                  )}
                />
              </button>
              {isOpen && (
                <div className="mt-0.5 space-y-0.5 pb-1.5">
                  {group.items.map((item) => (
                    <NavItemLink key={item.to} item={item} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* 하단 버전 표시 */}
      <div className="border-t border-sidebar-border px-4 py-3">
        <p className="text-[10px] text-sidebar-foreground/25 tabular">v2.0.0</p>
      </div>
    </aside>
  );
}

/**
 * 모바일 전용 하단 탭바 (iOS 스타일).
 * 데스크톱(md+) 에선 숨김 — 데스크톱은 사이드바 사용.
 *
 * 탭 5개: 대시보드 · 회원 · 출입 · 일정 · 더보기
 *   - "더보기" 는 사이드바의 나머지 메뉴를 한 페이지에 그룹핑 (/more)
 *
 * 안전영역: env(safe-area-inset-bottom) 패딩으로 iPhone home indicator 회피.
 */
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  ScrollText,
  CalendarDays,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

interface TabItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** 활성 상태 매칭: 정확히 일치(end=true) 또는 prefix */
  exact?: boolean;
}

const TABS: TabItem[] = [
  { to: "/", label: "대시보드", icon: LayoutDashboard, exact: true },
  { to: "/members", label: "회원", icon: Users },
  { to: "/access-logs", label: "출입", icon: ScrollText },
  { to: "/classes", label: "일정", icon: CalendarDays },
  { to: "/more", label: "더보기", icon: Menu },
];

export default function BottomTabBar() {
  return (
    <nav
      className={cn(
        "md:hidden",
        "fixed bottom-0 left-0 right-0 z-30",
        "border-t border-border bg-card/95 backdrop-blur-md",
        // safe-area 적용 — iPhone home indicator 가 탭 위로 안 올라오게
        "pb-[env(safe-area-inset-bottom,0px)]",
      )}
      aria-label="모바일 네비게이션"
    >
      <ul className="flex h-14 items-stretch">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <li key={tab.to} className="flex-1">
              <NavLink
                to={tab.to}
                end={tab.exact}
                className={({ isActive }) =>
                  cn(
                    "flex h-full flex-col items-center justify-center gap-0.5 text-[10px] font-medium",
                    "transition-colors active:scale-[0.96]",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={cn(
                        "size-[22px] shrink-0 transition-transform",
                        isActive && "scale-105",
                      )}
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                    <span>{tab.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

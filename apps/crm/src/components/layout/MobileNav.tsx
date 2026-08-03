import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";
import { filterNavGroups } from "./navConfig";

// 모바일 하단 탭바용 짧은 라벨
const SHORT_LABEL: Record<string, string> = {
  고객케어: "케어",
  매장운영: "운영",
  지점관리: "지점",
  본사관리: "본사",
};

export default function MobileNav() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const groups = filterNavGroups(profile?.role);
  const primary = groups.slice(0, 4);

  return (
    <>
      {/* 하단 탭바 — 모바일 전용 (md 미만) */}
      <nav
        aria-label="하단 메뉴"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card md:hidden"
      >
        {primary.map((group) => {
          const item = group.items[0];
          if (!item) return null;
          const Icon = item.icon;
          return (
            <NavLink
              key={group.label}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isActive ? "text-primary" : "text-muted-foreground"
                )
              }
            >
              <Icon className="size-5" />
              {SHORT_LABEL[group.label] ?? group.label}
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="전체 메뉴 열기"
        >
          <Menu className="size-5" />
          더보기
        </button>
      </nav>

      {/* 더보기 시트 — 전체 메뉴 (모든 역할 항목) */}
      {open && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="전체 메뉴"
        >
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-foreground">전체 메뉴</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="메뉴 닫기"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="space-y-4 pb-6">
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="mb-1.5 text-[11px] font-bold tracking-wider text-muted-foreground">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.to === "/"}
                          onClick={() => setOpen(false)}
                          className={({ isActive }) =>
                            cn(
                              "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors",
                              isActive
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border text-foreground hover:bg-muted"
                            )
                          }
                        >
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

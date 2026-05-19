/**
 * 글로벌 검색 (Cmd+K / Ctrl+K)
 * - 회원 이름·전화번호 실시간 검색
 * - 메뉴 빠른 이동
 * - 키보드 ↑↓ 탐색, Enter 선택, Esc 닫기
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Search, X, User, LayoutDashboard, Users, CreditCard, ScrollText,
  Building2, Trophy, Wallet, CalendarDays, SmilePlus, UserCog,
  SendHorizontal, FileText, BarChart3, ArrowRight,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";

// ── 메뉴 아이템 정의 ──────────────────────────────────────
const MENU_ITEMS = [
  { label: "대시보드",    to: "/",                  icon: LayoutDashboard },
  { label: "회원 목록",   to: "/members",            icon: Users },
  { label: "이용권",     to: "/memberships",         icon: CreditCard },
  { label: "출입 로그",  to: "/access-logs",          icon: ScrollText },
  { label: "수업 일정",  to: "/classes",              icon: CalendarDays },
  { label: "회원만족 설문", to: "/surveys",           icon: SmilePlus },
  { label: "레벨",       to: "/levels",              icon: Trophy },
  { label: "수익/지출",  to: "/finance",             icon: Wallet },
  { label: "지점 관리",  to: "/branches",             icon: Building2 },
  { label: "직원 관리",  to: "/hr/staff",             icon: UserCog },
  { label: "그룹 발송",  to: "/admin/bulk-notify",    icon: SendHorizontal },
  { label: "메시지 템플릿", to: "/admin/msg-templates", icon: FileText },
  { label: "본사 현황",  to: "/hq",                   icon: BarChart3 },
];

// ── 회원 타입 ─────────────────────────────────────────────
interface MemberResult {
  id: string;
  name: string;
  phone: string | null;
  status: string;
}

// ── 상태 색상 ─────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  active:    "bg-success/10 text-success",
  trial:     "bg-blue-50 text-blue-700",
  expired:   "bg-muted text-muted-foreground",
  suspended: "bg-warning/10 text-warning",
  unpaid:    "bg-danger/10 text-danger",
  withdrawn: "bg-muted text-muted-foreground",
};
const STATUS_LABEL: Record<string, string> = {
  active: "활성", trial: "체험", expired: "만료",
  suspended: "정지", unpaid: "미납", withdrawn: "퇴회",
};

// ── 메인 컴포넌트 ──────────────────────────────────────────
export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { profile } = useAuth();

  // Cmd+K / Ctrl+K 단축키
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 열릴 때 인풋 포커스
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  // 회원 검색
  const { data: members = [] } = useQuery<MemberResult[]>({
    queryKey: ["global-search-members", query, profile?.branch_id],
    enabled: open && query.trim().length >= 1,
    staleTime: 10_000,
    queryFn: async () => {
      const q = query.trim();
      let base = supabase
        .from("members")
        .select("id,name,phone,status")
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(8);
      if (profile?.role && !["super_admin", "hq_admin"].includes(profile.role) && profile.branch_id) {
        base = base.eq("branch_id", profile.branch_id);
      }
      const { data } = await base;
      return (data ?? []) as MemberResult[];
    },
  });

  // 메뉴 필터
  const filteredMenus = query.trim().length === 0
    ? MENU_ITEMS.slice(0, 6)  // 빈 쿼리면 자주 쓰는 6개 표시
    : MENU_ITEMS.filter(m => m.label.includes(query.trim())).slice(0, 4);

  // 전체 결과 목록 (메뉴 + 회원)
  const totalItems = filteredMenus.length + members.length;

  // 키보드 탐색
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (cursor < filteredMenus.length) {
        const menu = filteredMenus[cursor];
        if (menu) { navigate(menu.to); setOpen(false); }
      } else {
        const member = members[cursor - filteredMenus.length];
        if (member) {
          navigate(`/members/${member.id}`);
          setOpen(false);
        }
      }
    }
  }, [cursor, filteredMenus, members, navigate]);

  // 커서 변경 시 스크롤
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function selectMenu(to: string) {
    navigate(to);
    setOpen(false);
  }

  function selectMember(id: string) {
    navigate(`/members/${id}`);
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
      onClick={() => setOpen(false)}
    >
      {/* 배경 오버레이 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* 검색 패널 */}
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        {/* 인풋 */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="회원 이름, 전화번호 또는 메뉴 검색…"
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={onKeyDown}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setCursor(0); inputRef.current?.focus(); }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
          <kbd className="hidden sm:flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            Esc
          </kbd>
        </div>

        {/* 결과 목록 */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto py-2">

          {/* 메뉴 */}
          {filteredMenus.length > 0 && (
            <div>
              <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                {query ? "메뉴" : "바로가기"}
              </p>
              {filteredMenus.map((item, i) => {
                const Icon = item.icon;
                const isActive = cursor === i;
                return (
                  <button
                    key={item.to}
                    data-idx={i}
                    onClick={() => selectMenu(item.to)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                      isActive ? "bg-primary/8 text-foreground" : "text-foreground/80 hover:bg-muted"
                    )}
                  >
                    <span className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg",
                      isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    )}>
                      <Icon className="size-3.5" />
                    </span>
                    <span className="flex-1 text-left font-medium">{item.label}</span>
                    <ArrowRight className={cn(
                      "size-3.5 transition-opacity",
                      isActive ? "opacity-50" : "opacity-0"
                    )} />
                  </button>
                );
              })}
            </div>
          )}

          {/* 회원 */}
          {members.length > 0 && (
            <div className={cn(filteredMenus.length > 0 && "mt-1 border-t border-border pt-1")}>
              <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                회원
              </p>
              {members.map((member, i) => {
                const idx = filteredMenus.length + i;
                const isActive = cursor === idx;
                return (
                  <button
                    key={member.id}
                    data-idx={idx}
                    onClick={() => selectMember(member.id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2.5 transition-colors",
                      isActive ? "bg-primary/8" : "hover:bg-muted"
                    )}
                  >
                    <span className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      isActive ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                    )}>
                      <User className="size-3.5" />
                    </span>
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{member.name}</p>
                      {member.phone && (
                        <p className="text-xs text-muted-foreground">{member.phone}</p>
                      )}
                    </div>
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0",
                      STATUS_COLOR[member.status] ?? "bg-muted text-muted-foreground"
                    )}>
                      {STATUS_LABEL[member.status] ?? member.status}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 결과 없음 */}
          {query.trim().length >= 1 && members.length === 0 && filteredMenus.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Search className="size-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                "<span className="font-semibold text-foreground">{query}</span>" 검색 결과가 없습니다.
              </p>
            </div>
          )}
        </div>

        {/* 하단 단축키 안내 */}
        <div className="flex items-center gap-4 border-t border-border px-4 py-2">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
            탐색
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
            선택
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
            닫기
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground/40">
            1자 이상 입력 시 회원 검색
          </span>
        </div>
      </div>
    </div>
  );
}

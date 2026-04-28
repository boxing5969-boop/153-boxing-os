import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/lib/roleLabels";
import { LogOut, Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

function useUnresolvedAlertCount() {
  return useQuery({
    queryKey: ["alert-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("device_sync_jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", "failed");
      return count ?? 0;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold select-none">
      {initials}
    </div>
  );
}

export default function Header() {
  const { user, profile, signOut } = useAuth();
  const { data: alertCount = 0 } = useUnresolvedAlertCount();
  const displayName = profile?.name ?? user?.email ?? "–";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      {/* 왼쪽: 페이지 컨텍스트용 공간 (추후 breadcrumb) */}
      <div />

      {/* 오른쪽: 알림 + 사용자 */}
      <div className="flex items-center gap-3">
        {/* 알림 벨 */}
        <div className="relative">
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="동기화 실패 알림"
          >
            <Bell className="size-4" />
          </button>
          {alertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-danger-foreground animate-fade-in">
              {alertCount > 9 ? "9+" : alertCount}
            </span>
          )}
        </div>

        {/* 구분선 */}
        <div className="h-6 w-px bg-border" />

        {/* 사용자 정보 */}
        <div className="flex items-center gap-2.5">
          <Avatar name={displayName} />
          <div className="hidden sm:flex flex-col leading-none">
            <span className="text-sm font-semibold text-foreground">{displayName}</span>
            <span className="text-xs text-muted-foreground">{roleLabel(profile?.role)}</span>
          </div>
        </div>

        {/* 로그아웃 */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void signOut()}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <LogOut className="size-3.5" />
          <span className="hidden sm:inline">로그아웃</span>
        </Button>
      </div>
    </header>
  );
}

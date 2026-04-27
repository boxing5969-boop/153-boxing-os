import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/lib/roleLabels";
import { LogOut } from "lucide-react";

export default function Header() {
  const { user, profile, signOut } = useAuth();
  return (
    <header className="h-14 shrink-0 border-b border-foreground/10 bg-background flex items-center justify-end gap-4 px-6">
      <div className="text-sm text-right">
        <div className="font-medium">{profile?.name ?? user?.email}</div>
        <div className="text-xs opacity-60">{roleLabel(profile?.role)}</div>
      </div>
      <Button variant="outline" size="sm" onClick={() => void signOut()}>
        <LogOut className="size-4" />
        로그아웃
      </Button>
    </header>
  );
}

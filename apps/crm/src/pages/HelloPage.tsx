import { Button } from "@/components/ui/button";

export default function HelloPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 bg-background text-foreground">
      <h1 className="text-3xl font-bold">153 BOXING OS</h1>
      <p className="text-sm opacity-70">Phase 2 — monorepo scaffold OK</p>
      <Button>시작하기</Button>
      <p className="text-xs opacity-50">Phase 3 (DB) 부터 실제 기능이 추가됩니다.</p>
    </main>
  );
}

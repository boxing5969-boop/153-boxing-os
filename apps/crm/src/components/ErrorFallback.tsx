import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  error: Error | unknown;
  resetError?: () => void;
}

export function ErrorFallback({ error, resetError }: Props) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
      <div className="max-w-md w-full space-y-4 rounded-lg border border-foreground/10 bg-background p-6">
        <div className="flex items-center gap-2 text-red-700">
          <AlertTriangle className="size-5" />
          <h1 className="text-lg font-bold">예상치 못한 오류가 발생했습니다</h1>
        </div>
        <p className="text-sm opacity-80">
          오류는 자동으로 보고됐습니다 (Sentry). 잠시 후 다시 시도하시거나, 아래
          버튼으로 화면을 복구하세요.
        </p>
        <details className="rounded-md bg-muted p-3 text-xs">
          <summary className="cursor-pointer opacity-70">기술 세부정보</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono">{message}</pre>
        </details>
        <div className="flex gap-2">
          {resetError && (
            <Button onClick={resetError} variant="outline">
              다시 시도
            </Button>
          )}
          <Button onClick={() => window.location.reload()}>새로고침</Button>
          <Button variant="ghost" onClick={() => (window.location.href = "/")}>
            대시보드로
          </Button>
        </div>
      </div>
    </main>
  );
}

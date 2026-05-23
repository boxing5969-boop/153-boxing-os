/**
 * 로딩 / 빈 상태 / 오류 — 공통 UI.
 *
 * 페이지마다 흩어져 있던 "로딩 중…", "데이터가 없습니다", "오류 발생"
 * 표현을 통일하기 위한 컴포넌트.
 *
 * 사용 예:
 *   if (isLoading) return <LoadingState />;
 *   if (isError)   return <ErrorState error={error} retry={refetch} />;
 *   if (rows.length === 0) return <EmptyState title="등록된 회원이 없습니다" />;
 */
import type { ReactNode } from "react";
import { Loader2, AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/lib/cn";

interface BaseProps {
  className?: string;
}

// ── 로딩 ─────────────────────────────────────────────
interface LoadingStateProps extends BaseProps {
  label?: string;
  /** 카드 가운데가 아닌 인라인 표시 (작은 영역) */
  inline?: boolean;
}

export function LoadingState({
  label = "불러오는 중…",
  inline = false,
  className,
}: LoadingStateProps) {
  if (inline) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 text-sm text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="size-4 animate-spin" />
        {label}
      </span>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="size-6 animate-spin" />
      <p>{label}</p>
    </div>
  );
}

// ── 빈 상태 ──────────────────────────────────────────
interface EmptyStateProps extends BaseProps {
  icon?: typeof Inbox;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-12 text-center",
        className,
      )}
    >
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
        <Icon className="size-7 text-muted-foreground/60" />
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description && (
        <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ── 오류 ─────────────────────────────────────────────
interface ErrorStateProps extends BaseProps {
  error?: unknown;
  title?: string;
  retry?: () => void;
}

function errorMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "알 수 없는 오류";
}

export function ErrorState({
  error,
  title = "오류가 발생했습니다",
  retry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-12 text-center",
        className,
      )}
    >
      <div className="flex size-14 items-center justify-center rounded-2xl bg-danger/10">
        <AlertTriangle className="size-7 text-danger" />
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
      {error !== undefined && (
        <p className="max-w-md text-sm text-danger">{errorMsg(error)}</p>
      )}
      {retry && (
        <button
          type="button"
          onClick={retry}
          className="mt-2 inline-flex h-9 items-center rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted active:scale-[0.97]"
        >
          다시 시도
        </button>
      )}
    </div>
  );
}

import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  badge?: ReactNode;
}

/**
 * iOS Large Title 풍 페이지 헤더.
 * 모바일: 제목 28px + 컬럼 정렬 (action 은 아래로),
 * 데스크톱(sm+): 24px + 한 줄 정렬.
 */
export default function PageHeader({ title, description, action, badge }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex flex-1 items-start gap-3 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-[28px] leading-tight tracking-tight font-black text-foreground sm:text-2xl">
              {title}
            </h1>
            {badge}
          </div>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground sm:mt-0.5">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

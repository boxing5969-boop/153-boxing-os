/**
 * 매출 기회 보드 — 3차
 * 최신 회원 상태 스냅샷에서 재등록·PT전환·추천 기회를 점수순으로 보여준다.
 * 데이터: member_status_snapshots (compute_member_snapshots 일배치가 적재).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Dumbbell, UserPlus, Link2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import {
  listRevenueOpportunities, type RevenueOpportunity,
} from "@/services/fcCare";

// 기회 유형별 임계 점수
const TH_RENEWAL = 50;
const TH_PT = 40;
const TH_REFERRAL = 50;

const PRODUCT_LABEL: Record<string, string> = {
  boxing: "복싱", gym: "헬스", pt: "PT", spinning: "스피닝",
  group_class: "그룹수업", trial: "체험", boxing_gym: "복싱+헬스", event: "이벤트",
};

function scoreTone(score: number): string {
  if (score >= 75) return "text-success";
  if (score >= 50) return "text-warning";
  return "text-muted-foreground";
}

// ── 기회 카드 ─────────────────────────────────────────────────
function OpportunityCard({
  o, score, context,
}: {
  o: RevenueOpportunity;
  score: number;
  context: string;
}) {
  return (
    <Link
      to={`/members/${o.member_id}`}
      className="block rounded-xl border border-border bg-card px-3 py-2.5 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-foreground truncate">
          {o.member_name ?? "회원"}
        </span>
        <span className={cn("text-sm font-black", scoreTone(score))}>{Math.round(score)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{PRODUCT_LABEL[o.product_type ?? ""] ?? o.product_type ?? "—"}</span>
        <span>·</span>
        <span>{context}</span>
      </div>
      {o.churn_risk_score >= 60 && (
        <p className="mt-1 text-[10px] font-semibold text-danger">
          이탈위험 {Math.round(o.churn_risk_score)} — 우선 연락 권장
        </p>
      )}
    </Link>
  );
}

// ── 기회 컬럼 ─────────────────────────────────────────────────
function Column({
  title, icon: Icon, items, render,
}: {
  title: string;
  icon: typeof CalendarClock;
  items: RevenueOpportunity[];
  render: (o: RevenueOpportunity) => { score: number; context: string };
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Icon className="size-4" />{title}
          <span className="text-xs font-medium text-muted-foreground">({items.length})</span>
        </h2>
        {items.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">해당 기회가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {items.map((o) => {
              const r = render(o);
              return <OpportunityCard key={o.member_id} o={o} score={r.score} context={r.context} />;
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════
export default function RevenueBoardPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["fc-revenue-board"],
    queryFn: listRevenueOpportunities,
  });

  const { renewal, pt, referral } = useMemo(() => {
    const rows = data ?? [];
    const sortDesc = (k: keyof RevenueOpportunity) =>
      (a: RevenueOpportunity, b: RevenueOpportunity) => Number(b[k]) - Number(a[k]);
    return {
      renewal: rows
        .filter((o) => Number(o.renewal_opportunity_score) >= TH_RENEWAL)
        .sort(sortDesc("renewal_opportunity_score")),
      pt: rows
        .filter((o) => Number(o.pt_conversion_score) >= TH_PT)
        .sort(sortDesc("pt_conversion_score")),
      referral: rows
        .filter((o) => Number(o.referral_potential_score) >= TH_REFERRAL)
        .sort(sortDesc("referral_potential_score")),
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-foreground">매출 기회 보드</h1>
        <p className="text-sm text-muted-foreground">
          최신 회원 분석 기준 — 재등록·PT 전환·추천 기회
        </p>
      </div>

      {isLoading && (
        <div className="grid gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          매출 기회 데이터를 불러오지 못했습니다.
        </div>
      )}

      {!isLoading && !isError && (data ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">
          분석된 회원 데이터가 없습니다. FC 일배치 실행 후 표시됩니다.
        </p>
      )}

      {!isLoading && !isError && (data ?? []).length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Summary label="재등록 기회" count={renewal.length} icon={CalendarClock} />
            <Summary label="PT 전환 기회" count={pt.length} icon={Dumbbell} />
            <Summary label="추천 기회" count={referral.length} icon={UserPlus} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Column
              title="재등록 기회" icon={CalendarClock} items={renewal}
              render={(o) => ({
                score: Number(o.renewal_opportunity_score),
                context: o.days_until_expiry != null
                  ? `만료 D-${o.days_until_expiry}`
                  : (o.membership_expiry_date ?? "만료일 미상"),
              })}
            />
            <Column
              title="PT 전환 기회" icon={Dumbbell} items={pt}
              render={(o) => ({
                score: Number(o.pt_conversion_score),
                context: o.pt_remaining_sessions != null
                  ? `PT 잔여 ${o.pt_remaining_sessions}회`
                  : "PT 미보유",
              })}
            />
            <Column
              title="추천 기회" icon={UserPlus} items={referral}
              render={(o) => ({
                score: Number(o.referral_potential_score),
                context: o.satisfaction_score != null
                  ? `만족도 ${o.satisfaction_score}`
                  : "꾸준 출석",
              })}
            />
          </div>

          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Link2 className="size-3" />
            카드를 클릭하면 회원 상세로 이동합니다.
          </p>
        </>
      )}
    </div>
  );
}

// ── 요약 카드 ─────────────────────────────────────────────────
function Summary({
  label, count, icon: Icon,
}: {
  label: string;
  count: number;
  icon: typeof CalendarClock;
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" />{label}
        </div>
        <p className="text-2xl font-black text-foreground">{count}<span className="text-sm font-bold text-muted-foreground">명</span></p>
      </CardContent>
    </Card>
  );
}

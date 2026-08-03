import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getMemberProfile } from "@/services/memberProfile";

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}

/** 브로제이 명단에서 가져온 확장 항목. 값이 있는 항목만 표시. */
export function MemberProfileCard({ memberId }: { memberId: string }) {
  const { data: p } = useQuery({
    queryKey: ["member-profile", memberId],
    queryFn: () => getMemberProfile(memberId),
    enabled: !!memberId,
  });
  if (!p) return null;

  const won = (n: number | null) => (n != null ? `${n.toLocaleString("ko-KR")}원` : null);
  const rows: Array<[string, string | null]> = [
    ["주소", p.address],
    ["방문 경로", p.visit_route],
    ["운동 목적", p.exercise_purpose],
    ["상담 담당자", p.coach_name],
    ["신규/재등록", p.new_or_re],
    ["누적 결제", won(p.cumulative_payment)],
    ["마지막 구매일", p.last_purchase_date],
    ["보유 락커", p.locker],
    ["대여권", p.rental],
    ["마일리지", p.mileage],
    ["보유 쿠폰", p.coupons],
    ["운톡(BROJ)", p.broj_runtalk],
    ["출석 번호", p.attendance_no],
    ["원본 상태", p.status_orig],
    ["특이사항", p.notes],
  ];
  const visible = rows.filter(([, v]) => Boolean(v));
  if (visible.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ClipboardList className="size-4 text-primary" /> 확장 정보 (브로제이)
        </h2>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {visible.map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

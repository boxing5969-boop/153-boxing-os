import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { roleLabel } from "@/lib/roleLabels";

interface Widget {
  label: string;
  value: string;
  hint: string;
}

const WIDGETS: Widget[] = [
  { label: "오늘 출입 성공", value: "—", hint: "PR 5.4 에서 실데이터" },
  { label: "오늘 출입 거절", value: "—", hint: "PR 5.4 에서 실데이터" },
  { label: "이번주 만료 예정", value: "—", hint: "PR 5.4 에서 실데이터" },
  { label: "단말기 동기화 실패", value: "—", hint: "Phase 6 에서 활성" },
];

export default function DashboardPage() {
  const { profile } = useAuth();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">대시보드</h1>
        <p className="mt-1 text-sm opacity-70">
          {profile?.name} ({roleLabel(profile?.role)}) — 오늘 운영 현황
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {WIDGETS.map((w) => (
          <Card key={w.label} className="p-4">
            <div className="text-sm opacity-70">{w.label}</div>
            <div className="mt-2 text-3xl font-bold">{w.value}</div>
            <div className="mt-1 text-xs opacity-50">{w.hint}</div>
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <h2 className="text-sm font-medium opacity-70">진행 상태</h2>
        <ul className="mt-2 space-y-1 text-sm opacity-80">
          <li>✅ PR 5.1: Auth + Layout + Login + Dashboard skeleton</li>
          <li className="opacity-60">⏳ PR 5.2: 회원 (목록 / 신규 / 상세)</li>
          <li className="opacity-60">⏳ PR 5.3: 이용권 / 체험권</li>
          <li className="opacity-60">⏳ PR 5.4: 출입로그 + 장비 + 대시보드 실데이터</li>
          <li className="opacity-60">⏳ PR 5.5: 방문자 / 지점 / 레벨 / 설정</li>
        </ul>
      </Card>
    </div>
  );
}

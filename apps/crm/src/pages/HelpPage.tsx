import { ExternalLink, Phone, AlertCircle, BookOpen } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DENIED_REASON_LABELS, type DeniedReason } from "@153/shared";

const DENIED_REASON_ACTIONS: Record<DeniedReason, string> = {
  expired_membership: "이용권 새로 등록 권유",
  unpaid: "결제 확인 후 payment_status='paid'",
  suspended: "사유 확인 후 새 이용권 등록",
  no_valid_grant: "이용권/체험권 등록 필요",
  trial_expired: "체험권 만료 — 이용권 권유",
  trial_max_used: "체험권 횟수 소진 — 이용권 권유",
  qr_expired: "랭킹업앱에서 새 QR 발급",
  qr_already_used: "랭킹업앱에서 새 QR 발급",
  qr_invalid_signature: "토큰 변조 가능 — 본사 보고",
  device_error: "비상 PIN 발급 + 단말기 점검",
  unknown_user: "회원 등록 / face 등록 확인 / 비상 PIN",
  outside_allowed_time: "허용 시간 외 — 정책 안내",
  consent_revoked: "동의 철회 회원 — 재동의 또는 거절",
};

const QUICK_LINKS: { label: string; href: string; description: string }[] = [
  {
    label: "운영 매뉴얼 (전체)",
    href: "https://github.com/boxing5969-boop/153-boxing-os/blob/main/docs/operator-guide.md",
    description: "9개 섹션 — 일상 업무 / 출입 거절 / 단말기 / 직원 / 동의 / 사고 대응 / 정기 점검",
  },
  {
    label: "외부 파트너 API",
    href: "https://github.com/boxing5969-boop/153-boxing-os/blob/main/docs/external-api.md",
    description: "랭킹업앱 ↔ CRM 연동 API 사양 (백엔드 개발자용)",
  },
  {
    label: "배포 가이드",
    href: "https://github.com/boxing5969-boop/153-boxing-os/blob/main/docs/phase8-deployment-guide.md",
    description: "Cloudflare + Supabase 베타 운영 셋업",
  },
];

export default function HelpPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title="도움말"
        description="자주 쓰는 절차 + 출입 거절 사유별 안내 + 외부 문서 링크"
      />

      <Card className="rounded-2xl">
        <CardHeader>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <BookOpen className="size-4" />
            전체 매뉴얼
          </h2>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {QUICK_LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="-mx-2 flex items-start gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60"
                >
                  <ExternalLink className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{l.label}</div>
                    <div className="text-xs text-muted-foreground">{l.description}</div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <AlertCircle className="size-4" />
            출입 거절 사유별 안내
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            회원이 거절됐을 때 직원이 즉시 참고할 수 있는 액션 매트릭스
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">시스템 사유</th>
                <th className="px-4 py-2">회원에게 안내 문구</th>
                <th className="px-4 py-2">직원 조치</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(DENIED_REASON_LABELS) as DeniedReason[]).map((r) => (
                <tr key={r} className="border-b border-border/60">
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r}</td>
                  <td className="px-4 py-2">{DENIED_REASON_LABELS[r]}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {DENIED_REASON_ACTIONS[r] ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="rounded-2xl">
          <CardHeader>
            <h2 className="text-sm font-semibold text-foreground">자주 쓰는 절차</h2>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li>
                <strong>신규 회원 등록</strong> — /members → 신규 등록
              </li>
              <li>
                <strong>이용권/체험권 발급</strong> — /members/&lt;id&gt; → 등록 버튼
              </li>
              <li>
                <strong>비상 PIN 발급</strong> — /admin/emergency-pins → PIN 발급
              </li>
              <li>
                <strong>단말기 장애 — 강제 동기화</strong> — /devices → 동기화 버튼
              </li>
              <li>
                <strong>키 회전</strong> — /devices → 키 회전 (분기 1회 권장)
              </li>
              <li>
                <strong>직원 초대</strong> (hq) — /staff → 직원 초대
              </li>
              <li>
                <strong>얼굴 동의 철회</strong> — /members/&lt;id&gt; → 동의 관리 → 철회
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Phone className="size-4" />
              비상 연락처
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">운영 시작 시 본사관리자가 채워넣음</p>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">본사 운영팀</dt>
              <dd className="col-span-2">[TBD]</dd>
              <dt className="text-muted-foreground">시스템 개발팀</dt>
              <dd className="col-span-2">[TBD]</dd>
              <dt className="text-muted-foreground">단말기 벤더</dt>
              <dd className="col-span-2">[TBD]</dd>
              <dt className="text-muted-foreground">Supabase 지원</dt>
              <dd className="col-span-2 break-all">support@supabase.io</dd>
              <dt className="text-muted-foreground">Cloudflare</dt>
              <dd className="col-span-2 break-all">dash.cloudflare.com → Help</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

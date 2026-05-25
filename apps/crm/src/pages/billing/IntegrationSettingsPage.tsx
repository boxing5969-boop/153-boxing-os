/**
 * 통합 설정 (read-only status).
 * - Aligo / Payssam / KT 통화비서 (placeholder) 상태만 표시
 * - 시크릿 키는 절대 노출 X
 */
import { useEffect, useState } from "react";
import { useBranch } from "@/contexts/BranchContext";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { listIntegrationAccounts, listSenders, type IntegrationAccount, type MessageSender } from "@/services/billing";

const PROVIDER_LABEL: Record<string, string> = {
  payssam: "결제선생 (Payssam)",
  aligo: "Aligo 문자",
  kt_call_assistant: "KT AI 통화비서",
};

export default function IntegrationSettingsPage() {
  const { tenantId } = useBranch();
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [senders, setSenders] = useState<MessageSender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [a, s] = await Promise.all([listIntegrationAccounts(tenantId), listSenders(tenantId)]);
        if (cancelled) return;
        setAccounts(a);
        setSenders(s);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const byProvider = new Map<string, IntegrationAccount[]>();
  for (const a of accounts) {
    const list = byProvider.get(a.provider) ?? [];
    list.push(a);
    byProvider.set(a.provider, list);
  }

  function providerStatus(provider: string): "active" | "inactive" | "error" | "not_configured" {
    const accs = byProvider.get(provider);
    if (!accs || accs.length === 0) return "not_configured";
    if (accs.some((a) => a.status === "error")) return "error";
    if (accs.some((a) => a.status === "active")) return "active";
    return "inactive";
  }

  const STATUS_LABEL: Record<string, { label: string; tone: "success" | "warning" | "danger" | "muted" }> = {
    active: { label: "연결됨", tone: "success" },
    inactive: { label: "비활성", tone: "muted" },
    error: { label: "오류", tone: "danger" },
    not_configured: { label: "미설정", tone: "warning" },
  };
  const META_FALLBACK = { label: "—", tone: "muted" as const };

  return (
    <div className="space-y-5">
      <PageHeader title="통합 설정" description="외부 서비스 연결 상태 (시크릿 키는 노출되지 않음)" />

      {error && <Card className="p-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</Card>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(["payssam", "aligo", "kt_call_assistant"] as const).map((p) => {
          const s = providerStatus(p);
          const meta = STATUS_LABEL[s] ?? META_FALLBACK;
          return (
            <Card key={p} className="p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">{PROVIDER_LABEL[p]}</div>
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </div>
              {p === "kt_call_assistant" && (
                <p className="mt-2 text-[11px] text-slate-400">통합 준비중 (Phase 후반)</p>
              )}
              {p === "aligo" && (
                <p className="mt-2 text-[11px] text-slate-500">
                  발신번호 {senders.filter((x) => x.status === "approved").length}개 승인됨 ·{" "}
                  대기 {senders.filter((x) => x.status === "pending").length}개
                </p>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold">발신번호 (Aligo)</h2>
        </div>
        {loading ? (
          <div className="p-5 text-sm text-slate-400">불러오는 중…</div>
        ) : senders.length === 0 ? (
          <div className="p-5 text-sm text-slate-400">등록된 발신번호가 없습니다.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {senders.map((s) => {
              const tone =
                s.status === "approved" ? "success" :
                s.status === "rejected" ? "danger" :
                s.status === "disabled" ? "muted" :
                "warning";
              const label =
                s.status === "approved" ? "승인됨" :
                s.status === "rejected" ? "거절됨" :
                s.status === "disabled" ? "비활성" :
                "대기 중";
              return (
                <div key={s.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                  <div className="flex-1 font-mono tabular-nums">{s.sender_number}</div>
                  <Badge tone={tone}>{label}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-4 text-[12px] text-slate-500 leading-relaxed">
        <strong className="text-slate-700">보안 안내</strong>
        <p className="mt-1">
          API 키·시크릿은 절대 화면에 노출되지 않습니다. Cloud Run 서버 (Google Secret Manager) 에서만 사용됩니다.
          연결 정보 등록·수정은 본사 관리자 채널로 요청해 주세요.
        </p>
      </Card>
    </div>
  );
}

import { type FormEvent, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageCircle, Eye, EyeOff, CheckCircle2, ToggleLeft, ToggleRight, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/cn";
import { runNotificationsNow, type SendReport } from "@/services/notificationSend";

interface KakaoConfig {
  kakao_pfid: string | null;
  kakao_sender_phone: string | null;
  kakao_tpl_d7: string | null;
  kakao_tpl_d3: string | null;
  kakao_tpl_d1: string | null;
  kakao_enabled: boolean;
}

interface Props {
  branchId: string;
  config: KakaoConfig | null;
  onSaved: () => void;
}

async function saveBranchKakao(branchId: string, body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string;
  const res = await fetch(`${baseUrl}/api/admin/branches/${branchId}/kakao`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(j.error?.message ?? `HTTP ${res.status}`);
  }
}

export default function BranchKakaoSettingsCard({ branchId, config, onSaved }: Props) {
  const [pfid, setPfid] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [tplD7, setTplD7] = useState("");
  const [tplD3, setTplD3] = useState("");
  const [tplD1, setTplD1] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [success, setSuccess] = useState(false);
  const [testReport, setTestReport] = useState<SendReport | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const testMutation = useMutation({
    mutationFn: runNotificationsNow,
    onSuccess: (report) => {
      setTestReport(report);
      setTestError(null);
    },
    onError: (err) => {
      setTestError(err instanceof Error ? err.message : "발송 오류");
      setTestReport(null);
    },
  });

  useEffect(() => {
    if (!config) return;
    setPfid(config.kakao_pfid ?? "");
    setSenderPhone(config.kakao_sender_phone ?? "");
    setTplD7(config.kakao_tpl_d7 ?? "");
    setTplD3(config.kakao_tpl_d3 ?? "");
    setTplD1(config.kakao_tpl_d1 ?? "");
    setEnabled(config.kakao_enabled ?? false);
    // API keys are never sent back from server (encrypted)
  }, [config]);

  const mutation = useMutation({
    mutationFn: () => saveBranchKakao(branchId, {
      kakao_pfid: pfid.trim(),
      kakao_sender_phone: senderPhone.trim(),
      kakao_tpl_d7: tplD7.trim() || undefined,
      kakao_tpl_d3: tplD3.trim() || undefined,
      kakao_tpl_d1: tplD1.trim() || undefined,
      kakao_api_key: apiKey.trim() || undefined,
      kakao_api_secret: apiSecret.trim() || undefined,
      kakao_enabled: enabled,
    }),
    onSuccess: () => {
      setApiKey(""); setApiSecret("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      onSaved();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  const hasConfig = !!(config?.kakao_pfid);

  return (
    <Card>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">카카오 알림톡 설정</span>
          {hasConfig && (
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold",
              config?.kakao_enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
            )}>
              {config?.kakao_enabled ? "활성" : "비활성"}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEnabled(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {enabled
            ? <ToggleRight className="size-5 text-success" />
            : <ToggleLeft className="size-5 text-muted-foreground" />}
          {enabled ? "활성화" : "비활성"}
        </button>
      </div>

      <CardContent className="pt-5">
        <p className="text-xs text-muted-foreground mb-4">
          각 지점이 Solapi 계정을 개별 가입하면 알림톡 비용이 지점별로 청구됩니다.
          API 키는 암호화하여 저장되며 다시 조회되지 않습니다.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pfid">카카오 채널 pfId</Label>
              <Input id="pfid" placeholder="KA01PF..." value={pfid} onChange={e => setPfid(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sender-phone">발신 번호 (하이픈 없이)</Label>
              <Input id="sender-phone" placeholder="15991999" value={senderPhone} onChange={e => setSenderPhone(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-d7">템플릿 ID — D-7</Label>
              <Input id="tpl-d7" placeholder="KA01TP..." value={tplD7} onChange={e => setTplD7(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-d3">템플릿 ID — D-3</Label>
              <Input id="tpl-d3" placeholder="KA01TP..." value={tplD3} onChange={e => setTplD3(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-d1">템플릿 ID — D-1</Label>
              <Input id="tpl-d1" placeholder="KA01TP..." value={tplD1} onChange={e => setTplD1(e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-warning/40 bg-warning/5 p-4 space-y-3">
            <p className="text-xs font-semibold text-warning">Solapi API 키 (저장 후 다시 조회 불가)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="api-key">API Key</Label>
                <div className="relative">
                  <Input
                    id="api-key"
                    type={showKey ? "text" : "password"}
                    placeholder={hasConfig ? "변경 시에만 입력" : "Solapi API Key"}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    className="pr-9"
                  />
                  <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="api-secret">API Secret</Label>
                <div className="relative">
                  <Input
                    id="api-secret"
                    type={showSecret ? "text" : "password"}
                    placeholder={hasConfig ? "변경 시에만 입력" : "Solapi API Secret"}
                    value={apiSecret}
                    onChange={e => setApiSecret(e.target.value)}
                    className="pr-9"
                  />
                  <button type="button" onClick={() => setShowSecret(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {mutation.error && (
            <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5">
              <div className="size-1.5 rounded-full bg-danger shrink-0" />
              <p className="text-sm text-danger">{mutation.error instanceof Error ? mutation.error.message : "저장 실패"}</p>
            </div>
          )}

          <div className="flex items-center justify-between">
            {success && (
              <div className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 className="size-4" />
                저장되었습니다
              </div>
            )}
            <div className="ml-auto">
              <Button type="submit" disabled={mutation.isPending} className="gap-2 px-6">
                {mutation.isPending ? (
                  <><span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />저장 중…</>
                ) : "설정 저장"}
              </Button>
            </div>
          </div>
        </form>

        {/* 즉시 발송 테스트 */}
        <div className="mt-5 pt-5 border-t border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">지금 발송 테스트</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                오늘의 자동 발송 대상(D-7/3/1 만료 예정 + 마케팅 동의 회원)에게 즉시 발송합니다.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 shrink-0"
              disabled={testMutation.isPending || !config?.kakao_enabled}
              onClick={() => { setTestReport(null); setTestError(null); testMutation.mutate(); }}
            >
              {testMutation.isPending
                ? <><span className="size-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />발송 중…</>
                : <><Send className="size-3.5" />지금 발송</>}
            </Button>
          </div>
          {!config?.kakao_enabled && (
            <p className="mt-2 text-xs text-warning">카카오 알림톡이 비활성화 상태입니다. 활성화 후 사용하세요.</p>
          )}
          {testError && (
            <p className="mt-2 rounded-md bg-danger/5 border border-danger/20 px-3 py-2 text-xs text-danger">{testError}</p>
          )}
          {testReport && (
            <div className="mt-2 rounded-md bg-muted/50 border border-border px-3 py-2.5 text-xs space-y-1">
              <p className="font-medium text-foreground">발송 결과</p>
              <p className="text-muted-foreground">
                전체 <strong>{testReport.total}</strong>건 &middot; 성공 <strong className="text-success">{testReport.sent}</strong>건 &middot; 실패 <strong className={testReport.failed > 0 ? "text-danger" : ""}>{testReport.failed}</strong>건 &middot; 스킵 {testReport.skipped}건
              </p>
              {testReport.total === 0 && (
                <p className="text-muted-foreground">오늘 발송할 대상이 없습니다 (마케팅 동의 + D-7/3/1 만료 예정 회원 없음)</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

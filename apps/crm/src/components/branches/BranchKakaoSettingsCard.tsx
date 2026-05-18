/**
 * 지점 알리고(Aligo) 문자/알림톡 설정 카드
 * - SMS: 8.4원/건, LMS: 25원/건, 알림톡: 4.8원/건
 * - API Key + User ID 방식 (HMAC 불필요)
 * - DB 컬럼 재활용: kakao_api_key_enc=API키, kakao_api_secret_enc=UserID,
 *   kakao_pfid=SenderKey, kakao_tpl_d7/d3/d1=템플릿코드
 */
import { type FormEvent, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageCircle, Eye, EyeOff, CheckCircle2, ToggleLeft, ToggleRight, Send, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/cn";
import { runNotificationsNow, type SendReport } from "@/services/notificationSend";

interface KakaoConfig {
  kakao_pfid: string | null;       // 알리고 Sender Key (발신프로필 키)
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
  // 알리고 Sender Key (구 pfId 컬럼 재활용)
  const [senderKey, setSenderKey] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [tplD7, setTplD7] = useState("");
  const [tplD3, setTplD3] = useState("");
  const [tplD1, setTplD1] = useState("");
  // 알리고 API Key + User ID (구 api_key/api_secret 컬럼 재활용)
  const [apiKey, setApiKey] = useState("");
  const [userId, setUserId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showUserId, setShowUserId] = useState(false);
  const [success, setSuccess] = useState(false);
  const [testReport, setTestReport] = useState<SendReport | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const testMutation = useMutation({
    mutationFn: runNotificationsNow,
    onSuccess: (report) => { setTestReport(report); setTestError(null); },
    onError: (err) => { setTestError(err instanceof Error ? err.message : "발송 오류"); setTestReport(null); },
  });

  useEffect(() => {
    if (!config) return;
    setSenderKey(config.kakao_pfid ?? "");
    setSenderPhone(config.kakao_sender_phone ?? "");
    setTplD7(config.kakao_tpl_d7 ?? "");
    setTplD3(config.kakao_tpl_d3 ?? "");
    setTplD1(config.kakao_tpl_d1 ?? "");
    setEnabled(config.kakao_enabled ?? false);
    // API Key / User ID는 보안상 서버에서 다시 내려주지 않음
  }, [config]);

  const mutation = useMutation({
    mutationFn: () => saveBranchKakao(branchId, {
      kakao_pfid: senderKey.trim(),          // 알리고 Sender Key
      kakao_sender_phone: senderPhone.trim(),
      kakao_tpl_d7: tplD7.trim() || undefined,
      kakao_tpl_d3: tplD3.trim() || undefined,
      kakao_tpl_d1: tplD1.trim() || undefined,
      kakao_api_key: apiKey.trim() || undefined,      // 알리고 API Key
      kakao_api_secret: userId.trim() || undefined,   // 알리고 User ID (secret 컬럼 재활용)
      kakao_enabled: enabled,
    }),
    onSuccess: () => {
      setApiKey(""); setUserId("");
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
          <span className="font-semibold text-sm text-foreground">문자 / 알림톡 설정</span>
          <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-[10px] font-bold">알리고</span>
          {hasConfig && (
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
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

      <CardContent className="pt-5 space-y-5">

        {/* 안내 */}
        <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3 space-y-1.5">
          <p className="text-xs font-semibold text-blue-800">알리고(Aligo) 연동 방법</p>
          <ol className="text-xs text-blue-700 space-y-0.5 list-decimal list-inside">
            <li><a href="https://smartsms.aligo.in" target="_blank" rel="noreferrer" className="underline underline-offset-2 inline-flex items-center gap-0.5">smartsms.aligo.in <ExternalLink className="size-2.5" /></a> 가입 후 API Key 발급</li>
            <li>발신번호 등록 (통신사 인증, 1~2일 소요)</li>
            <li>카카오 알림톡 사용 시: 채널 연동 → Sender Key 확인 → 템플릿 등록</li>
          </ol>
          <p className="text-[11px] text-blue-600 mt-1">
            SMS 8.4원 · LMS 25원 · 알림톡 4.8원 (VAT 별도)
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* 발신번호 */}
          <div className="space-y-1.5">
            <Label htmlFor="sender-phone">SMS 발신번호 <span className="text-muted-foreground font-normal">(하이픈 없이)</span></Label>
            <Input
              id="sender-phone"
              placeholder="15991999 또는 01012345678"
              value={senderPhone}
              onChange={e => setSenderPhone(e.target.value)}
            />
          </div>

          {/* 알리고 API 자격증명 */}
          <div className="rounded-lg border border-dashed border-warning/40 bg-warning/5 p-4 space-y-3">
            <p className="text-xs font-semibold text-warning">알리고 API 자격증명 (저장 후 다시 조회 불가 — 암호화 저장)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="api-key">API Key</Label>
                <div className="relative">
                  <Input
                    id="api-key"
                    type={showKey ? "text" : "password"}
                    placeholder={hasConfig ? "변경 시에만 입력" : "알리고 API Key"}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    className="pr-9"
                  />
                  <button type="button" onClick={() => setShowKey(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">알리고 대시보드 → 개발정보 → API Key</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user-id">User ID</Label>
                <div className="relative">
                  <Input
                    id="user-id"
                    type={showUserId ? "text" : "password"}
                    placeholder={hasConfig ? "변경 시에만 입력" : "알리고 가입 ID"}
                    value={userId}
                    onChange={e => setUserId(e.target.value)}
                    className="pr-9"
                  />
                  <button type="button" onClick={() => setShowUserId(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showUserId ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">알리고 로그인 아이디 (이메일)</p>
              </div>
            </div>
          </div>

          {/* 카카오 알림톡 설정 (선택) */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              카카오 알림톡 설정 <span className="normal-case font-normal">(선택 — SMS만 쓰면 안 해도 됨)</span>
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="sender-key">Sender Key <span className="text-muted-foreground font-normal">(발신프로필 키, 40자)</span></Label>
              <Input
                id="sender-key"
                placeholder="알리고 카카오 채널 연동 후 발급되는 40자 키"
                value={senderKey}
                onChange={e => setSenderKey(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">알리고 대시보드 → 카카오 알림톡 → 발신프로필 관리</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-d7">템플릿 코드 — D-7</Label>
                <Input id="tpl-d7" placeholder="예: TJ_0001" value={tplD7} onChange={e => setTplD7(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-d3">템플릿 코드 — D-3</Label>
                <Input id="tpl-d3" placeholder="예: TJ_0002" value={tplD3} onChange={e => setTplD3(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-d1">템플릿 코드 — D-1</Label>
                <Input id="tpl-d1" placeholder="예: TJ_0003" value={tplD1} onChange={e => setTplD1(e.target.value)} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              알리고 → 카카오 알림톡 → 템플릿 관리에서 템플릿 심사 후 발급되는 코드
            </p>
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
                {mutation.isPending
                  ? <><span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />저장 중…</>
                  : "설정 저장"}
              </Button>
            </div>
          </div>
        </form>

        {/* 즉시 발송 테스트 */}
        <div className="pt-4 border-t border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">발송 테스트</p>
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
            <p className="mt-2 text-xs text-warning">비활성화 상태입니다. 설정 저장 후 활성화해주세요.</p>
          )}
          {testError && (
            <p className="mt-2 rounded-md bg-danger/5 border border-danger/20 px-3 py-2 text-xs text-danger">{testError}</p>
          )}
          {testReport && (
            <div className="mt-2 rounded-md bg-muted/50 border border-border px-3 py-2.5 text-xs space-y-1">
              <p className="font-medium text-foreground">발송 결과</p>
              <p className="text-muted-foreground">
                전체 <strong>{testReport.total}</strong>건 &middot;
                성공 <strong className="text-success">{testReport.sent}</strong>건 &middot;
                실패 <strong className={testReport.failed > 0 ? "text-danger" : ""}>{testReport.failed}</strong>건 &middot;
                스킵 {testReport.skipped}건
              </p>
              {testReport.total === 0 && (
                <p className="text-muted-foreground">오늘 발송할 대상이 없습니다 (D-7/3/1 만료 예정 + 마케팅 동의 회원 없음)</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

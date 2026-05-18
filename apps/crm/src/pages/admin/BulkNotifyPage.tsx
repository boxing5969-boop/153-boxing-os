import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Send, Users, CheckCircle, XCircle, AlertTriangle, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendBulkMsg, listTemplates, type MsgChannel } from "@/services/messaging";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";

// ── 채널 옵션 ─────────────────────────────────────────────
const CHANNEL_OPTIONS: { value: MsgChannel; label: string; hint: string }[] = [
  { value: "kakao",             label: "카카오 알림톡",        hint: "Solapi 카카오 채널 필요" },
  { value: "sms",               label: "문자 (SMS/LMS)",       hint: "발신 번호 등록 필요" },
  { value: "both",              label: "문자 + 카카오 동시",    hint: "양쪽 모두 발송" },
  { value: "kakao_sms_fallback", label: "카카오 (실패 시 SMS)", hint: "카카오 실패 시 자동 SMS" },
];

const DAY_OPTIONS = [
  { days: 7,  label: "7일 이내 만료",  hint: "D-7/3/1 예정 회원" },
  { days: 14, label: "14일 이내 만료", hint: "2주 내 예정 회원" },
  { days: 30, label: "30일 이내 만료", hint: "1개월 내 예정 회원" },
];

const VAR_CHIPS = ["#{회원명}", "#{만료일}", "#{남은일수}", "#{지점명}", "#{플랜명}"];

// ── 발송 결과 타입 ─────────────────────────────────────────
interface SendReport {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
}

export default function BulkNotifyPage() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id ?? "";

  const [daysAhead, setDaysAhead] = useState(7);
  const [channel, setChannel] = useState<MsgChannel>("kakao");
  const [content, setContent] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const [report, setReport] = useState<SendReport | null>(null);
  const [targetsCount, setTargetsCount] = useState<number | null>(null);
  const [step, setStep] = useState<"ready" | "previewed" | "done">("ready");

  const { data: templates = [] } = useQuery({
    queryKey: ["msg-templates", branchId],
    queryFn: () => listTemplates(branchId),
    enabled: !!branchId && useTemplate,
    staleTime: 60_000,
  });

  // 미리보기 (dry_run)
  const previewMut = useMutation({
    mutationFn: () =>
      sendBulkMsg({ days_ahead: daysAhead, channel, content: content || undefined, dry_run: true }),
    onSuccess: (res) => {
      setTargetsCount(res.targets_count);
      setReport(null);
      setStep("previewed");
    },
  });

  // 실발송
  const sendMut = useMutation({
    mutationFn: () =>
      sendBulkMsg({ days_ahead: daysAhead, channel, content: content || undefined }),
    onSuccess: (res) => {
      setReport(res.report ?? null);
      setStep("done");
    },
  });

  function reset() {
    setTargetsCount(null);
    setReport(null);
    setStep("ready");
  }

  function insertVar(v: string) {
    setContent(c => c + v);
  }

  function applyTemplate(tmpl: { content: string; channel: MsgChannel }) {
    setContent(tmpl.content);
    setChannel(tmpl.channel);
    setUseTemplate(false);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-black text-foreground">그룹 발송</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          만료 예정 회원에게 문자·카카오 알림을 일괄 발송합니다.
          마케팅 동의 + 전화번호 등록 회원만 발송됩니다.
        </p>
      </div>

      {/* 경고 배너 */}
      <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
        <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
        <div className="text-sm text-warning/90 space-y-1">
          <p className="font-semibold">발송 전 확인사항</p>
          <p>지점 카카오/SMS 설정이 완료되어 있어야 합니다.</p>
          <p>수동 그룹 발송은 중복 체크를 하지 않습니다. (오늘 이미 발송된 회원도 재발송)</p>
        </div>
      </div>

      {/* 설정 카드 */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-card space-y-5">

        {/* 발송 채널 */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">발송 채널</p>
          <div className="grid grid-cols-2 gap-2">
            {CHANNEL_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => { setChannel(opt.value); reset(); }}
                className={cn(
                  "rounded-lg border p-3 text-left transition-all",
                  channel === opt.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40 hover:bg-muted/50"
                )}
              >
                <p className={cn("text-sm font-bold", channel === opt.value ? "text-primary" : "text-foreground")}>
                  {opt.label}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{opt.hint}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 발송 대상 */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">발송 대상</p>
          <div className="grid grid-cols-3 gap-2">
            {DAY_OPTIONS.map(opt => (
              <button
                key={opt.days}
                onClick={() => { setDaysAhead(opt.days); reset(); }}
                className={cn(
                  "rounded-lg border p-3 text-left transition-all",
                  daysAhead === opt.days
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40 hover:bg-muted/50"
                )}
              >
                <p className={cn("text-sm font-bold", daysAhead === opt.days ? "text-primary" : "text-foreground")}>
                  {opt.label}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{opt.hint}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 메시지 내용 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              메시지 내용 <span className="normal-case font-normal">(비워두면 지점 기본 알림톡 발송)</span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs gap-1 h-6"
              onClick={() => setUseTemplate(!useTemplate)}
            >
              <MessageSquare className="size-3" />
              {useTemplate ? "직접 입력" : "템플릿 불러오기"}
            </Button>
          </div>

          {/* 템플릿 선택 */}
          {useTemplate && (
            <div className="space-y-1.5 max-h-40 overflow-y-auto rounded-lg border border-border bg-muted/30 p-2">
              {templates.filter(t => t.is_active).length === 0 ? (
                <p className="text-xs text-muted-foreground p-2">저장된 활성 템플릿이 없습니다.</p>
              ) : templates.filter(t => t.is_active).map(t => (
                <button
                  key={t.id}
                  onClick={() => applyTemplate(t)}
                  className="w-full text-left rounded-md border border-border bg-background px-3 py-2 hover:border-primary/40 transition-all"
                >
                  <p className="text-xs font-medium text-foreground">{t.name}</p>
                  <p className="text-[11px] text-muted-foreground line-clamp-1">{t.content}</p>
                </button>
              ))}
            </div>
          )}

          {/* 변수 칩 */}
          <div className="flex flex-wrap gap-1.5">
            {VAR_CHIPS.map(v => (
              <button
                key={v}
                onClick={() => insertVar(v)}
                className="rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
              >
                {v}
              </button>
            ))}
          </div>

          <textarea
            rows={4}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
            placeholder={`비워두면 기본 알림톡 템플릿이 발송됩니다.\n직접 입력 시 자유 문자 형식으로 발송됩니다.`}
            value={content}
            onChange={e => { setContent(e.target.value); reset(); }}
          />
          {content && (
            <p className="text-[11px] text-muted-foreground">
              {new TextEncoder().encode(content).length}바이트
              {new TextEncoder().encode(content).length > 90 ? " → LMS" : " → SMS"}
            </p>
          )}
        </div>

        {/* 미리보기 버튼 */}
        <Button
          variant="outline"
          className="gap-2 w-full"
          disabled={previewMut.isPending}
          onClick={() => previewMut.mutate()}
        >
          {previewMut.isPending
            ? <><span className="size-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />조회 중…</>
            : <><Users className="size-4" />발송 대상 미리보기</>}
        </Button>

        {previewMut.error && (
          <p className="text-xs text-danger">
            {previewMut.error instanceof Error ? previewMut.error.message : "조회 오류"}
          </p>
        )}

        {/* 미리보기 결과 */}
        {step === "previewed" && targetsCount !== null && (
          <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-primary" />
              <span className="text-sm font-semibold">
                발송 예정 인원: <span className="text-primary text-lg">{targetsCount}명</span>
              </span>
            </div>
            {targetsCount === 0 ? (
              <p className="text-xs text-muted-foreground">해당 조건의 마케팅 동의 회원이 없습니다.</p>
            ) : (
              <div className="flex gap-2">
                <Button
                  className="gap-2"
                  disabled={sendMut.isPending}
                  onClick={() => sendMut.mutate()}
                >
                  {sendMut.isPending
                    ? <><span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />발송 중…</>
                    : <><Send className="size-4" />{targetsCount}명에게 발송</>}
                </Button>
                <Button variant="ghost" onClick={reset}>취소</Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 발송 결과 */}
      {step === "done" && report && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-card space-y-4">
          <p className="text-sm font-semibold">발송 완료</p>
          <div className="grid grid-cols-3 gap-3">
            <ResultBox label="전체" value={report.total} />
            <ResultBox label="성공" value={report.sent} color="success" />
            <ResultBox label="실패" value={report.failed} color={report.failed > 0 ? "danger" : "default"} />
          </div>
          {report.skipped > 0 && (
            <p className="text-xs text-muted-foreground">건너뜀: {report.skipped}명 (전화번호 없음 또는 동의 미체크)</p>
          )}
          <Button variant="outline" onClick={reset}>다시 발송</Button>
        </div>
      )}

      {sendMut.error && (
        <div className="rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
          {sendMut.error instanceof Error ? sendMut.error.message : "발송 오류"}
        </div>
      )}
    </div>
  );
}

function ResultBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className={cn(
      "rounded-lg p-3 text-center",
      color === "success" ? "bg-success/5" : color === "danger" ? "bg-danger/5" : "bg-muted/50"
    )}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn(
        "text-2xl font-black tabular",
        color === "success" ? "text-success" : color === "danger" ? "text-danger" : "text-foreground"
      )}>{value}</p>
    </div>
  );
}

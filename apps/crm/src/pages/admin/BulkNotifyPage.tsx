import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Users, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendBulkMsg } from "@/services/messaging";
import { cn } from "@/lib/cn";
import MessageComposerPanel, {
  createDefaultComposer,
  type ComposerState,
} from "@/components/messaging/MessageComposerPanel";

// ── 발송 대상 옵션 ─────────────────────────────────────────
const DAY_OPTIONS = [
  { days: 7,  label: "7일 이내 만료",  hint: "D-7/3/1 예정 회원" },
  { days: 14, label: "14일 이내 만료", hint: "2주 내 예정 회원" },
  { days: 30, label: "30일 이내 만료", hint: "1개월 내 예정 회원" },
];

interface SendReport {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
}

export default function BulkNotifyPage() {
  const [daysAhead, setDaysAhead] = useState(7);
  const [composer, setComposer] = useState<ComposerState>(createDefaultComposer("kakao"));
  const [report, setReport] = useState<SendReport | null>(null);
  const [targetsCount, setTargetsCount] = useState<number | null>(null);
  const [step, setStep] = useState<"ready" | "previewed" | "done">("ready");

  // 미리보기 (dry_run)
  const previewMut = useMutation({
    mutationFn: () =>
      sendBulkMsg({
        days_ahead: daysAhead,
        channel: composer.channel,
        content: composer.content || undefined,
        dry_run: true,
      }),
    onSuccess: (res) => {
      setTargetsCount(res.targets_count);
      setReport(null);
      setStep("previewed");
    },
  });

  // 실발송
  const sendMut = useMutation({
    mutationFn: () =>
      sendBulkMsg({
        days_ahead: daysAhead,
        channel: composer.channel,
        content: composer.content || undefined,
      }),
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

  function handleComposerChange(next: ComposerState) {
    setComposer(next);
    reset();
  }

  return (
    <div className="space-y-6 max-w-5xl">
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
          <p>수동 그룹 발송은 중복 체크를 하지 않습니다. (오늘 이미 발송된 회원도 재발송될 수 있습니다)</p>
        </div>
      </div>

      {/* 설정 카드 */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-card space-y-5">

        {/* 발송 대상 기간 */}
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
                <p className={cn(
                  "text-sm font-bold",
                  daysAhead === opt.days ? "text-primary" : "text-foreground"
                )}>
                  {opt.label}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{opt.hint}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 메시지 작성 패널 (채널 + 내용 + 폰 미리보기) */}
        <MessageComposerPanel
          value={composer}
          onChange={handleComposerChange}
          estimatedCount={targetsCount ?? undefined}
          senderName="153복싱짐"
        >
          {/* 미리보기 → 발송 버튼 */}
          {step === "ready" && (
            <Button
              variant="outline"
              className="gap-2 w-full"
              disabled={previewMut.isPending}
              onClick={() => previewMut.mutate()}
            >
              {previewMut.isPending ? (
                <>
                  <span className="size-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
                  조회 중…
                </>
              ) : (
                <>
                  <Users className="size-4" />
                  발송 대상 미리보기
                </>
              )}
            </Button>
          )}

          {previewMut.error && (
            <p className="text-xs text-danger">
              {previewMut.error instanceof Error ? previewMut.error.message : "조회 오류"}
            </p>
          )}

          {step === "previewed" && targetsCount !== null && (
            <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-primary" />
                <span className="text-sm font-semibold">
                  발송 예정 인원:{" "}
                  <span className="text-primary text-lg">{targetsCount}명</span>
                </span>
              </div>
              {targetsCount === 0 ? (
                <p className="text-xs text-muted-foreground">
                  해당 조건의 마케팅 동의 회원이 없습니다.
                </p>
              ) : (
                <div className="flex gap-2">
                  <Button
                    className="gap-2"
                    disabled={sendMut.isPending}
                    onClick={() => sendMut.mutate()}
                  >
                    {sendMut.isPending ? (
                      <>
                        <span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        발송 중…
                      </>
                    ) : (
                      <>
                        <Send className="size-4" />
                        {targetsCount}명에게 발송
                      </>
                    )}
                  </Button>
                  <Button variant="ghost" onClick={reset}>취소</Button>
                </div>
              )}
            </div>
          )}

          {sendMut.error && (
            <div className="rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
              {sendMut.error instanceof Error ? sendMut.error.message : "발송 오류"}
            </div>
          )}
        </MessageComposerPanel>
      </div>

      {/* 발송 결과 */}
      {step === "done" && report && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-card space-y-4">
          <p className="text-sm font-semibold text-foreground">발송 완료</p>
          <div className="grid grid-cols-3 gap-3">
            <ResultBox label="전체" value={report.total} />
            <ResultBox label="성공" value={report.sent} color="success" />
            <ResultBox label="실패" value={report.failed} color={report.failed > 0 ? "danger" : "default"} />
          </div>
          {report.skipped > 0 && (
            <p className="text-xs text-muted-foreground">
              건너뜀: {report.skipped}명 (전화번호 없음 또는 동의 미체크)
            </p>
          )}
          <Button variant="outline" onClick={reset}>다시 발송</Button>
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
      )}>
        {value}
      </p>
    </div>
  );
}

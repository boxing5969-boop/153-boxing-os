import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { X, Send, Users, CheckCircle, Megaphone, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { broadcastMsg } from "@/services/messaging";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";
import MessageComposerPanel, {
  createDefaultComposer,
  type ComposerState,
} from "@/components/messaging/MessageComposerPanel";

// ── 대상 상태 옵션 ─────────────────────────────────────────
const STATUS_OPTIONS = [
  { value: "active",    label: "이용중",   color: "bg-success/10 text-success" },
  { value: "trial",     label: "체험중",   color: "bg-blue-50 text-blue-700" },
  { value: "expired",   label: "만료",     color: "bg-muted text-muted-foreground" },
  { value: "suspended", label: "정지",     color: "bg-warning/10 text-warning" },
  { value: "unpaid",    label: "미납",     color: "bg-danger/10 text-danger" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MemberBroadcastDialog({ open, onClose }: Props) {
  const { profile } = useAuth();

  const [composer, setComposer] = useState<ComposerState>(createDefaultComposer("kakao"));
  const [targetStatuses, setTargetStatuses] = useState<string[]>(["active"]);

  // 단계: ready → previewed → done
  const [step, setStep] = useState<"ready" | "previewed" | "done">("ready");
  const [targetsCount, setTargetsCount] = useState<number | null>(null);
  const [report, setReport] = useState<{
    total: number; success: number; failed: number;
  } | null>(null);

  const previewMut = useMutation({
    mutationFn: () => broadcastMsg({
      channel: composer.channel,
      content: composer.content,
      target_statuses: targetStatuses,
      dry_run: true,
    }),
    onSuccess: (res) => {
      setTargetsCount(res.targets_count);
      setStep("previewed");
    },
  });

  const sendMut = useMutation({
    mutationFn: () => broadcastMsg({
      channel: composer.channel,
      content: composer.content,
      target_statuses: targetStatuses,
    }),
    onSuccess: (res) => {
      setReport(res.report ?? null);
      setStep("done");
    },
  });

  function toggleStatus(s: string) {
    setTargetStatuses(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
    resetSend();
  }

  function resetSend() {
    setStep("ready");
    setTargetsCount(null);
    setReport(null);
  }

  function handleComposerChange(next: ComposerState) {
    setComposer(next);
    resetSend();
  }

  function handleClose() {
    resetSend();
    setComposer(createDefaultComposer("kakao"));
    setTargetStatuses(["active"]);
    onClose();
  }

  if (!open) return null;

  const canPreview = composer.content.trim().length > 0 && targetStatuses.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

      {/* 다이얼로그 — max-w-3xl로 폰 미리보기 수용 */}
      <div className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-card shadow-2xl border border-border flex flex-col">

        {/* 헤더 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
            <Megaphone className="size-4 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-foreground">회원 공지 발송</h2>
            <p className="text-xs text-muted-foreground">선택한 회원에게 문자·카카오를 보냅니다</p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {step !== "done" ? (
          <div className="flex-1 p-5 space-y-5">

            {/* 발송 대상 상태 */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                발송 대상 <span className="normal-case font-normal">(마케팅 동의 + 전화번호 보유 회원만)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => toggleStatus(opt.value)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-all",
                      targetStatuses.includes(opt.value)
                        ? `${opt.color} border-current/30`
                        : "border-border text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    {targetStatuses.includes(opt.value) && <span className="mr-1">✓</span>}
                    {opt.label}
                  </button>
                ))}
              </div>
              {targetStatuses.length === 0 && (
                <p className="text-xs text-danger">최소 1개 이상 선택하세요</p>
              )}
            </div>

            {/* 주의 안내 */}
            <div className="flex gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2.5">
              <AlertTriangle className="size-3.5 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-warning/90">
                마케팅 수신 동의를 한 회원에게만 발송됩니다. 전화번호가 없는 회원은 제외됩니다.
              </p>
            </div>

            {/* 메시지 작성 패널 (폰 미리보기 포함) */}
            <MessageComposerPanel
              value={composer}
              onChange={handleComposerChange}
              estimatedCount={targetsCount ?? undefined}
              senderName="153복싱짐"
            >
              {/* 미리보기 → 발송 흐름 */}
              {step === "ready" && (
                <Button
                  className="w-full gap-2"
                  variant="outline"
                  disabled={!canPreview || previewMut.isPending}
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
                  {previewMut.error instanceof Error ? previewMut.error.message : "오류 발생"}
                </p>
              )}

              {step === "previewed" && targetsCount !== null && (
                <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-primary" />
                    <p className="text-sm font-semibold">
                      발송 예정:{" "}
                      <span className="text-primary text-base">{targetsCount}명</span>
                    </p>
                  </div>
                  {targetsCount === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      해당 조건의 마케팅 동의 회원이 없습니다.
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        className="flex-1 gap-2"
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
                      <Button variant="ghost" onClick={resetSend}>다시 설정</Button>
                    </div>
                  )}
                </div>
              )}

              {sendMut.error && (
                <p className="text-xs text-danger">
                  {sendMut.error instanceof Error ? sendMut.error.message : "발송 오류"}
                </p>
              )}
            </MessageComposerPanel>
          </div>
        ) : (
          /* 발송 완료 화면 */
          <div className="flex-1 p-5 flex flex-col items-center justify-center gap-5 text-center">
            <div className="size-16 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle className="size-8 text-success" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">발송 완료!</p>
              <p className="text-sm text-muted-foreground mt-1">
                총 {report?.total ?? 0}명에게 발송을 시도했습니다
              </p>
            </div>

            {report && (
              <div className="w-full grid grid-cols-3 gap-3">
                <ResultBox label="전체" value={report.total} />
                <ResultBox label="성공" value={report.success} color="success" />
                <ResultBox
                  label="실패"
                  value={report.failed}
                  color={report.failed > 0 ? "danger" : undefined}
                />
              </div>
            )}

            <div className="flex gap-2 w-full">
              <Button variant="outline" className="flex-1" onClick={resetSend}>
                다시 발송
              </Button>
              <Button className="flex-1" onClick={handleClose}>완료</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultBox({
  label, value, color,
}: {
  label: string; value: number; color?: "success" | "danger";
}) {
  return (
    <div className={cn(
      "rounded-xl p-3 text-center",
      color === "success" ? "bg-success/5"
        : color === "danger" ? "bg-danger/5"
        : "bg-muted/50"
    )}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn(
        "text-xl font-black tabular",
        color === "success" ? "text-success"
          : color === "danger" ? "text-danger"
          : "text-foreground"
      )}>
        {value}
      </p>
    </div>
  );
}

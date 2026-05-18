import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Users, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runBulkNotify, type SendReport } from "@/services/notificationSend";
import { cn } from "@/lib/cn";

const DAY_OPTIONS = [
  { days: 7,  label: "7일 이내 만료",  hint: "D-7/3/1 만료 예정 회원" },
  { days: 14, label: "14일 이내 만료", hint: "2주 내 만료 예정 회원" },
  { days: 30, label: "30일 이내 만료", hint: "1개월 내 만료 예정 회원" },
];

export default function BulkNotifyPage() {
  const [daysAhead, setDaysAhead] = useState(7);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [report, setReport] = useState<SendReport | null>(null);
  const [step, setStep] = useState<"ready" | "previewed" | "done">("ready");

  const previewMutation = useMutation({
    mutationFn: () => runBulkNotify({ days_ahead: daysAhead, dry_run: true }),
    onSuccess: (res) => {
      setPreviewCount(res.targets_count);
      setReport(null);
      setStep("previewed");
    },
  });

  const sendMutation = useMutation({
    mutationFn: () => runBulkNotify({ days_ahead: daysAhead, dry_run: false }),
    onSuccess: (res) => {
      setReport(res.report ?? null);
      setStep("done");
    },
  });

  function reset() {
    setPreviewCount(null);
    setReport(null);
    setStep("ready");
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-black text-foreground">그룹 문자 발송</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          만료 예정 회원에게 카카오 알림톡을 일괄 발송합니다.
          마케팅 동의 + 전화번호 등록 회원만 발송됩니다.
        </p>
      </div>

      {/* 안내 배너 */}
      <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
        <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
        <div className="text-sm text-warning/90 space-y-1">
          <p className="font-semibold">발송 전 확인사항</p>
          <p>각 지점 Solapi 계정의 카카오 알림톡 설정이 완료되어 있어야 합니다.</p>
          <p>이미 오늘 발송된 회원은 중복 발송되지 않습니다 (D-7/3/1 자동 발송 제외)</p>
          <p>단, 수동 그룹 발송은 중복 체크를 하지 않습니다.</p>
        </div>
      </div>

      {/* 발송 범위 선택 */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-card space-y-4">
        <p className="text-sm font-semibold text-foreground">발송 대상 선택</p>
        <div className="grid grid-cols-3 gap-3">
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

        {/* 미리보기 버튼 */}
        <Button
          variant="outline"
          className="gap-2"
          disabled={previewMutation.isPending}
          onClick={() => previewMutation.mutate()}
        >
          {previewMutation.isPending
            ? <><span className="size-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />조회 중…</>
            : <><Users className="size-4" />발송 대상 미리보기</>}
        </Button>

        {/* 미리보기 결과 */}
        {step === "previewed" && previewCount !== null && (
          <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">
                발송 예정 인원: <span className="text-primary text-lg">{previewCount}명</span>
              </span>
            </div>
            {previewCount === 0 ? (
              <p className="text-xs text-muted-foreground">
                해당 조건의 마케팅 동의 회원이 없습니다.
              </p>
            ) : (
              <div className="flex gap-2">
                <Button
                  className="gap-2"
                  disabled={sendMutation.isPending}
                  onClick={() => sendMutation.mutate()}
                >
                  {sendMutation.isPending
                    ? <><span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />발송 중…</>
                    : <><Send className="size-4" />{previewCount}명에게 발송</>}
                </Button>
                <Button variant="ghost" onClick={reset}>취소</Button>
              </div>
            )}
          </div>
        )}

        {previewMutation.error && (
          <p className="text-xs text-danger">{previewMutation.error instanceof Error ? previewMutation.error.message : "조회 오류"}</p>
        )}
      </div>

      {/* 발송 결과 */}
      {step === "done" && report && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-card space-y-4">
          <p className="text-sm font-semibold text-foreground">발송 완료</p>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground">전체</p>
              <p className="text-2xl font-black text-foreground tabular">{report.total}</p>
            </div>
            <div className="rounded-lg bg-success/5 p-3 text-center">
              <p className="text-xs text-muted-foreground">성공</p>
              <p className="text-2xl font-black text-success tabular">{report.sent}</p>
            </div>
            <div className="rounded-lg bg-danger/5 p-3 text-center">
              <p className="text-xs text-muted-foreground">실패</p>
              <p className={cn("text-2xl font-black tabular", report.failed > 0 ? "text-danger" : "text-foreground")}>
                {report.failed}
              </p>
            </div>
          </div>

          {/* 상세 목록 */}
          {report.details.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {report.details.map((d, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
                  {d.status === "sent"
                    ? <CheckCircle className="size-3.5 text-success shrink-0" />
                    : d.status === "failed"
                    ? <XCircle className="size-3.5 text-danger shrink-0" />
                    : <AlertTriangle className="size-3.5 text-warning shrink-0" />}
                  <span className="text-sm text-foreground flex-1">{d.member_name}</span>
                  <span className="text-xs text-muted-foreground tabular">{d.member_phone ?? "-"}</span>
                  {d.error && (
                    <span className="text-xs text-danger truncate max-w-[200px]" title={d.error}>{d.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <Button variant="outline" onClick={reset}>다시 발송</Button>
        </div>
      )}

      {sendMutation.error && (
        <div className="rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
          {sendMutation.error instanceof Error ? sendMutation.error.message : "발송 오류가 발생했습니다."}
        </div>
      )}
    </div>
  );
}

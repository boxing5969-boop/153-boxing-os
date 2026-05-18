import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  X, Send, Users, CheckCircle, XCircle, AlertTriangle,
  MessageSquare, Phone, Megaphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { broadcastMsg, listTemplates, type MsgChannel } from "@/services/messaging";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";

// ── 채널 옵션 ─────────────────────────────────────────────
const CHANNEL_OPTIONS: { value: MsgChannel; label: string; icon: React.ReactNode }[] = [
  { value: "kakao",              label: "카카오 알림톡",       icon: <MessageSquare className="size-3.5" /> },
  { value: "sms",                label: "문자 (SMS/LMS)",      icon: <Phone className="size-3.5" /> },
  { value: "both",               label: "카카오 + 문자 동시",  icon: <span className="text-xs font-bold">2채널</span> },
  { value: "kakao_sms_fallback", label: "카카오 (실패→SMS)",   icon: <MessageSquare className="size-3.5" /> },
];

// ── 대상 상태 옵션 ─────────────────────────────────────────
const STATUS_OPTIONS = [
  { value: "active",    label: "이용중",   color: "bg-success/10 text-success" },
  { value: "trial",     label: "체험중",   color: "bg-blue-50 text-blue-700" },
  { value: "expired",   label: "만료",     color: "bg-muted text-muted-foreground" },
  { value: "suspended", label: "정지",     color: "bg-warning/10 text-warning" },
  { value: "unpaid",    label: "미납",     color: "bg-danger/10 text-danger" },
];

// ── 변수 치환 칩 ───────────────────────────────────────────
const VAR_CHIPS = ["#{회원명}", "#{지점명}"];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MemberBroadcastDialog({ open, onClose }: Props) {
  const { profile } = useAuth();
  const branchId = profile?.branch_id ?? "";

  const [channel, setChannel] = useState<MsgChannel>("kakao");
  const [targetStatuses, setTargetStatuses] = useState<string[]>(["active"]);
  const [content, setContent] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);

  // 단계: ready → previewed → done
  const [step, setStep] = useState<"ready" | "previewed" | "done">("ready");
  const [targetsCount, setTargetsCount] = useState<number | null>(null);
  const [report, setReport] = useState<{ total: number; sent: number; failed: number; skipped: number } | null>(null);

  const { data: templates = [] } = useQuery({
    queryKey: ["msg-templates", branchId],
    queryFn: () => listTemplates(branchId),
    enabled: !!branchId && useTemplate,
    staleTime: 60_000,
  });

  const previewMut = useMutation({
    mutationFn: () => broadcastMsg({
      channel, content, target_statuses: targetStatuses, dry_run: true,
    }),
    onSuccess: (res) => {
      setTargetsCount(res.targets_count);
      setStep("previewed");
    },
  });

  const sendMut = useMutation({
    mutationFn: () => broadcastMsg({ channel, content, target_statuses: targetStatuses }),
    onSuccess: (res) => {
      setReport(res.report ?? null);
      setStep("done");
    },
  });

  function toggleStatus(s: string) {
    setTargetStatuses(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
    setStep("ready");
  }

  function insertVar(v: string) {
    setContent(c => c + v);
  }

  function applyTemplate(t: { content: string; channel: MsgChannel }) {
    setContent(t.content);
    setChannel(t.channel);
    setUseTemplate(false);
  }

  function resetSend() {
    setStep("ready");
    setTargetsCount(null);
    setReport(null);
  }

  function handleClose() {
    resetSend();
    setContent("");
    setChannel("kakao");
    setTargetStatuses(["active"]);
    setUseTemplate(false);
    onClose();
  }

  if (!open) return null;

  const byteCount = new TextEncoder().encode(content).length;
  const canPreview = content.trim().length > 0 && targetStatuses.length > 0;

  return (
    // 오버레이
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

      {/* 다이얼로그 */}
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-card shadow-2xl border border-border flex flex-col">

        {/* 헤더 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
            <Megaphone className="size-4 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-foreground">회원 공지 발송</h2>
            <p className="text-xs text-muted-foreground">선택한 회원에게 문자·카카오를 보냅니다</p>
          </div>
          <button onClick={handleClose} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="size-4" />
          </button>
        </div>

        {step !== "done" ? (
          <div className="flex-1 p-5 space-y-5">
            {/* 채널 선택 */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">발송 채널</p>
              <div className="grid grid-cols-2 gap-2">
                {CHANNEL_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setChannel(opt.value); resetSend(); }}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-all",
                      channel === opt.value
                        ? "border-primary bg-primary/5 text-primary font-medium"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/40"
                    )}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 대상 상태 */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">발송 대상 (마케팅 동의 회원만 발송)</p>
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

            {/* 메시지 작성 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">메시지 내용</p>
                <button
                  onClick={() => setUseTemplate(!useTemplate)}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <MessageSquare className="size-3" />
                  {useTemplate ? "직접 입력" : "템플릿 불러오기"}
                </button>
              </div>

              {/* 템플릿 선택 */}
              {useTemplate && (
                <div className="rounded-lg border border-border bg-muted/30 p-2 space-y-1 max-h-36 overflow-y-auto">
                  {templates.filter(t => t.is_active).length === 0 ? (
                    <p className="text-xs text-muted-foreground p-1">저장된 템플릿이 없습니다</p>
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
              <div className="flex gap-1.5 flex-wrap">
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
                rows={5}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                placeholder={`안녕하세요 #{회원명}님!\n153복싱짐에서 공지드립니다.\n\n내용을 입력하세요.`}
                value={content}
                onChange={e => { setContent(e.target.value); resetSend(); }}
              />
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                  {byteCount}바이트 {byteCount > 90 ? "→ LMS" : "→ SMS"}
                </p>
                {content.length > 0 && (
                  <button onClick={() => { setContent(""); resetSend(); }} className="text-[11px] text-muted-foreground hover:text-danger">
                    내용 지우기
                  </button>
                )}
              </div>
            </div>

            {/* 주의 안내 */}
            <div className="flex gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2.5">
              <AlertTriangle className="size-3.5 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-warning/90">마케팅 동의를 한 회원에게만 발송됩니다. 전화번호가 없는 회원은 제외됩니다.</p>
            </div>

            {/* 대상 미리보기 / 발송 */}
            {step === "ready" && (
              <Button
                className="w-full gap-2"
                variant="outline"
                disabled={!canPreview || previewMut.isPending}
                onClick={() => previewMut.mutate()}
              >
                {previewMut.isPending
                  ? <><span className="size-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />조회 중…</>
                  : <><Users className="size-4" />발송 대상 미리보기</>}
              </Button>
            )}

            {previewMut.error && (
              <p className="text-xs text-danger">{previewMut.error instanceof Error ? previewMut.error.message : "오류 발생"}</p>
            )}

            {step === "previewed" && targetsCount !== null && (
              <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-primary" />
                  <p className="text-sm font-semibold">
                    발송 예정: <span className="text-primary text-base">{targetsCount}명</span>
                  </p>
                </div>
                {targetsCount === 0 ? (
                  <p className="text-xs text-muted-foreground">해당 조건의 마케팅 동의 회원이 없습니다.</p>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 gap-2"
                      disabled={sendMut.isPending}
                      onClick={() => sendMut.mutate()}
                    >
                      {sendMut.isPending
                        ? <><span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />발송 중…</>
                        : <><Send className="size-4" />{targetsCount}명에게 발송</>}
                    </Button>
                    <Button variant="ghost" onClick={resetSend}>다시 설정</Button>
                  </div>
                )}
              </div>
            )}

            {sendMut.error && (
              <p className="text-xs text-danger">{sendMut.error instanceof Error ? sendMut.error.message : "발송 오류"}</p>
            )}
          </div>
        ) : (
          /* 발송 완료 화면 */
          <div className="flex-1 p-5 flex flex-col items-center justify-center gap-5 text-center">
            <div className="size-16 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle className="size-8 text-success" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">발송 완료!</p>
              <p className="text-sm text-muted-foreground mt-1">총 {report?.total ?? 0}명에게 발송을 시도했습니다</p>
            </div>

            {report && (
              <div className="w-full grid grid-cols-3 gap-3">
                <ResultBox label="전체" value={report.total} />
                <ResultBox label="성공" value={report.sent} color="success" />
                <ResultBox label="실패" value={report.failed} color={report.failed > 0 ? "danger" : undefined} />
              </div>
            )}

            {report && report.skipped > 0 && (
              <p className="text-xs text-muted-foreground">건너뜀: {report.skipped}명 (전화번호 없음 또는 동의 미체크)</p>
            )}

            <div className="flex gap-2 w-full">
              <Button variant="outline" className="flex-1" onClick={resetSend}>다시 발송</Button>
              <Button className="flex-1" onClick={handleClose}>완료</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultBox({ label, value, color }: { label: string; value: number; color?: "success" | "danger" }) {
  return (
    <div className={cn(
      "rounded-xl p-3 text-center",
      color === "success" ? "bg-success/5" : color === "danger" ? "bg-danger/5" : "bg-muted/50"
    )}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn(
        "text-xl font-black tabular",
        color === "success" ? "text-success" : color === "danger" ? "text-danger" : "text-foreground"
      )}>{value}</p>
    </div>
  );
}

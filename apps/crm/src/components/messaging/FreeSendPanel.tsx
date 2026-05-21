/**
 * 자유 문자 발송 패널 — 만료 알림과 무관한 공지·안내를 자유 문구로 발송한다.
 * 수신자: 개인 / 유효회원(active·trial) / 전체(탈퇴 제외)
 * 메시지 유형: 정보성(동의·시간 제약 없음) / 광고성(마케팅 동의자 + 08~21시)
 * 백엔드: 개인 → /api/admin/members/:id/send, 그룹 → /api/admin/notify/broadcast
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Send, User, Users, Search, X, Info, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { sendMemberMsg, broadcastMsg, type MsgType } from "@/services/messaging";
import MessageComposerPanel, {
  createDefaultComposer,
  type ComposerState,
} from "@/components/messaging/MessageComposerPanel";
import { cn } from "@/lib/cn";

type RecipientMode = "individual" | "active" | "all";

interface MemberHit { id: string; name: string; phone: string | null; }
interface SendReport { total: number; success: number; failed: number; }

const ACTIVE_STATUSES = ["active", "trial"];
const ALL_STATUSES = ["active", "trial", "expired", "unpaid", "suspended"];

// ── 회원 검색 (개인 발송용) ──────────────────────────────────
function MemberSearch({ selected, onSelect, onClear }: {
  selected: MemberHit | null;
  onSelect: (m: MemberHit) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");
  const { data: hits = [], isFetching } = useQuery<MemberHit[]>({
    queryKey: ["free-send-member-search", q],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select("id,name,phone")
        .ilike("name", `%${q.trim()}%`)
        .limit(8);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as MemberHit[];
    },
    enabled: q.trim().length >= 1 && !selected,
  });

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
        <User className="size-3.5 text-primary shrink-0" />
        <span className="text-sm text-foreground flex-1 truncate">
          {selected.name}
          <span className="ml-1.5 text-xs text-muted-foreground">{selected.phone ?? "전화번호 없음"}</span>
        </span>
        <button onClick={onClear} className="text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="회원 이름 검색…"
          className="flex-1 bg-transparent text-sm focus:outline-none"
        />
      </div>
      {q.trim().length >= 1 && (
        <div className="max-h-56 divide-y divide-border/50 overflow-y-auto rounded-lg border border-border bg-card">
          {isFetching ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">검색 중…</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">검색 결과가 없습니다.</p>
          ) : (
            hits.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelect(m)}
                className="w-full px-3 py-2 text-left transition-colors hover:bg-muted/50"
              >
                <span className="text-sm text-foreground">{m.name}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{m.phone ?? "전화번호 없음"}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── 작은 선택 버튼 ───────────────────────────────────────────
function PickButton({ active, onClick, title, desc }: {
  active: boolean; onClick: () => void; title: string; desc: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 text-left transition-all",
        active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/50"
      )}
    >
      <p className={cn("text-sm font-bold", active ? "text-primary" : "text-foreground")}>{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
    </button>
  );
}

// ── 메인 ─────────────────────────────────────────────────────
export default function FreeSendPanel() {
  const [mode, setMode] = useState<RecipientMode>("active");
  const [msgType, setMsgType] = useState<MsgType>("info");
  const [composer, setComposer] = useState<ComposerState>(createDefaultComposer("sms"));
  const [member, setMember] = useState<MemberHit | null>(null);
  const [targetsCount, setTargetsCount] = useState<number | null>(null);
  const [report, setReport] = useState<SendReport | null>(null);
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  const [step, setStep] = useState<"ready" | "previewed" | "done">("ready");

  function reset() {
    setTargetsCount(null);
    setReport(null);
    setSentMsg(null);
    setStep("ready");
  }

  const statuses = mode === "all" ? ALL_STATUSES : ACTIVE_STATUSES;

  const previewMut = useMutation({
    mutationFn: () =>
      broadcastMsg({
        channel: composer.channel,
        content: composer.content,
        target_statuses: statuses,
        message_type: msgType,
        dry_run: true,
      }),
    onSuccess: (res) => { setTargetsCount(res.targets_count); setStep("previewed"); },
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      if (mode === "individual") {
        if (!member) throw new Error("회원을 선택하세요");
        const r = await sendMemberMsg({
          member_id: member.id, channel: composer.channel,
          content: composer.content, message_type: msgType,
        });
        return { kind: "individual" as const, message: r.message };
      }
      const r = await broadcastMsg({
        channel: composer.channel, content: composer.content,
        target_statuses: statuses, message_type: msgType,
      });
      return { kind: "group" as const, report: r.report };
    },
    onSuccess: (res) => {
      if (res.kind === "individual") setSentMsg(res.message);
      else setReport(res.report ?? null);
      setStep("done");
    },
  });

  const canSend = composer.content.trim().length > 0 && (mode !== "individual" || !!member);

  return (
    <div className="space-y-5">
      {/* 수신자 */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">수신자</p>
        <div className="grid grid-cols-3 gap-2">
          <PickButton active={mode === "individual"} onClick={() => { setMode("individual"); reset(); }}
            title="개인" desc="회원 1명 검색 발송" />
          <PickButton active={mode === "active"} onClick={() => { setMode("active"); reset(); }}
            title="유효회원" desc="이용·체험 중 회원" />
          <PickButton active={mode === "all"} onClick={() => { setMode("all"); reset(); }}
            title="전체" desc="탈퇴 제외 전 회원" />
        </div>
        {mode === "individual" && (
          <MemberSearch
            selected={member}
            onSelect={(m) => { setMember(m); reset(); }}
            onClear={() => { setMember(null); reset(); }}
          />
        )}
      </div>

      {/* 메시지 유형 */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">메시지 유형</p>
        <div className="grid grid-cols-2 gap-2">
          <PickButton active={msgType === "info"} onClick={() => { setMsgType("info"); reset(); }}
            title="정보성 공지" desc="휴관·일정 등 안내 (동의·시간 제약 없음)" />
          <PickButton active={msgType === "ad"} onClick={() => { setMsgType("ad"); reset(); }}
            title="광고성" desc="할인·프로모션 (동의 회원만·08~21시)" />
        </div>
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          {msgType === "info"
            ? <><Info className="mt-0.5 size-3 shrink-0" /><span>순수 안내만 정보성입니다. 광고 문구가 섞이면 광고성으로 발송해야 합니다(정보통신망법).</span></>
            : <><Megaphone className="mt-0.5 size-3 shrink-0" /><span>마케팅 수신 동의 회원에게만, 08~21시에만 발송됩니다.</span></>}
        </p>
      </div>

      {/* 메시지 작성 + 발송 */}
      <MessageComposerPanel
        value={composer}
        onChange={(next) => { setComposer(next); reset(); }}
        estimatedCount={targetsCount ?? undefined}
        senderName="153복싱짐"
      >
        {composer.channel !== "sms" && (
          <p className="text-[11px] text-warning">
            카카오 알림톡은 사전 승인 템플릿이 필요합니다. 자유 문구는 SMS/LMS 채널을 권장합니다.
          </p>
        )}

        {/* 개인: 바로 발송 / 그룹: 미리보기 후 발송 */}
        {step === "ready" && mode === "individual" && (
          <Button className="w-full gap-2" disabled={!canSend || sendMut.isPending}
            onClick={() => sendMut.mutate()}>
            <Send className="size-4" />
            {sendMut.isPending ? "발송 중…" : `${member?.name ?? "회원"}님에게 발송`}
          </Button>
        )}
        {step === "ready" && mode !== "individual" && (
          <Button variant="outline" className="w-full gap-2"
            disabled={!canSend || previewMut.isPending}
            onClick={() => previewMut.mutate()}>
            <Users className="size-4" />
            {previewMut.isPending ? "조회 중…" : "발송 대상 미리보기"}
          </Button>
        )}

        {(previewMut.error || sendMut.error) && (
          <p className="text-xs text-danger">
            {(previewMut.error ?? sendMut.error) instanceof Error
              ? (previewMut.error ?? sendMut.error as Error).message
              : "오류가 발생했습니다"}
          </p>
        )}

        {step === "previewed" && targetsCount !== null && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
            <div className="flex items-center gap-2">
              <Users className="size-4 text-primary" />
              <span className="text-sm font-semibold">
                발송 예정 인원: <span className="text-lg text-primary">{targetsCount}명</span>
              </span>
            </div>
            {targetsCount === 0 ? (
              <p className="text-xs text-muted-foreground">
                조건에 맞는 발송 대상이 없습니다.
                {msgType === "ad" && " (광고성은 마케팅 동의 회원만 집계됩니다)"}
              </p>
            ) : (
              <div className="flex gap-2">
                <Button className="gap-2" disabled={sendMut.isPending} onClick={() => sendMut.mutate()}>
                  <Send className="size-4" />
                  {sendMut.isPending ? "발송 중…" : `${targetsCount}명에게 발송`}
                </Button>
                <Button variant="ghost" onClick={reset}>취소</Button>
              </div>
            )}
          </div>
        )}
      </MessageComposerPanel>

      {/* 결과 */}
      {step === "done" && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-card">
          <p className="text-sm font-semibold text-foreground">발송 완료</p>
          {sentMsg && <p className="text-sm text-success">{sentMsg}</p>}
          {report && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "전체", value: report.total, tone: "" },
                { label: "성공", value: report.success, tone: "text-success" },
                { label: "실패", value: report.failed, tone: report.failed > 0 ? "text-danger" : "" },
              ].map((b) => (
                <div key={b.label} className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">{b.label}</p>
                  <p className={cn("text-2xl font-black", b.tone)}>{b.value}</p>
                </div>
              ))}
            </div>
          )}
          <Button variant="outline" onClick={reset}>다시 발송</Button>
        </div>
      )}
    </div>
  );
}

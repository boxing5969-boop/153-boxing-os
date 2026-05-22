/**
 * 통합 메시지 작성 패널
 * - 실시간 폰 미리보기
 * - SMS/LMS/MMS 자동 감지 + 바이트 카운터
 * - 수신거부 문구 자동 추가 (광고성 문자 법적 의무)
 * - 야간 발송 경고 (21:00~08:00 KST)
 * - 발송 예상 비용
 * - 이미지 첨부 (MMS)
 * - 변수 치환 칩
 * - 템플릿 불러오기
 */
import { useState, useRef, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ImagePlus, X, Clock,
  MessageSquare, ToggleLeft, ToggleRight, Coins,
} from "lucide-react";
import SmsPhonePreview, {
  calcBytes, getMsgType, calcCost, type MsgType,
} from "@/components/messaging/SmsPhonePreview";
import { listTemplates, type MsgChannel } from "@/services/messaging";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";

// ── 변수 칩 ──────────────────────────────────────────────
const VAR_CHIPS = [
  "#{회원명}", "#{지점명}", "#{플랜명}", "#{만료일}", "#{남은일수}",
];

// ── 채널 옵션 ─────────────────────────────────────────────
export const CHANNEL_OPTIONS: { value: MsgChannel; label: string; hint: string }[] = [
  { value: "kakao",              label: "카카오 알림톡",         hint: "카카오채널 필요" },
  { value: "sms",                label: "문자 (SMS/LMS)",        hint: "발신번호 등록 필요" },
  { value: "both",               label: "카카오 + 문자 동시",    hint: "양쪽 모두 발송" },
  { value: "kakao_sms_fallback", label: "카카오 (실패 시 SMS)",  hint: "자동 폴백" },
];

// ── 기본 수신거부 문구 ─────────────────────────────────────
export const DEFAULT_OPT_OUT = "무료거부 080-000-0000";

// ── 야간 시간 체크 (KST 기준 21:00~08:00) ──────────────────
export function isNightTime(): boolean {
  const kstOffset = 9 * 60;
  const now = new Date();
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const kstMin = (utcMin + kstOffset) % (24 * 60);
  const kstH = Math.floor(kstMin / 60);
  return kstH >= 21 || kstH < 8;
}

// ── Props ────────────────────────────────────────────────
export interface ComposerState {
  channel: MsgChannel;
  content: string;
  optOut: boolean;
  optOutText: string;
  imageFile: File | null;
  imagePreviewUrl: string | null;
}

interface Props {
  value: ComposerState;
  onChange: (next: ComposerState) => void;
  /** 예상 발송 인원 (비용 계산용) */
  estimatedCount?: number;
  /** 채널 선택 숨기기 (외부에서 이미 선택한 경우) */
  hideChannel?: boolean;
  /** 발신자 이름 (폰 미리보기용) */
  senderName?: string;
  senderPhone?: string;
  /** 하단 추가 내용 */
  children?: React.ReactNode;
}

export function createDefaultComposer(channel: MsgChannel = "kakao"): ComposerState {
  return {
    channel,
    content: "",
    optOut: true,
    optOutText: DEFAULT_OPT_OUT,
    imageFile: null,
    imagePreviewUrl: null,
  };
}

export default function MessageComposerPanel({
  value, onChange, estimatedCount, hideChannel, senderName, senderPhone, children,
}: Props) {
  const { profile } = useAuth();
  const branchId = profile?.branch_id ?? "";
  const [showTemplates, setShowTemplates] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nightTime = isNightTime();

  const { data: templates = [] } = useQuery({
    queryKey: ["msg-templates", branchId],
    queryFn: () => listTemplates(branchId),
    enabled: !!branchId && showTemplates,
    staleTime: 60_000,
  });

  function set(patch: Partial<ComposerState>) {
    onChange({ ...value, ...patch });
  }

  function insertVar(v: string) {
    set({ content: value.content + v });
  }

  function applyTemplate(t: { content: string; channel: MsgChannel }) {
    set({ content: t.content, channel: t.channel });
    setShowTemplates(false);
  }

  function handleImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 300 * 1024) {
      alert("이미지는 300KB 이하만 첨부 가능합니다 (MMS 규격)");
      return;
    }
    const url = URL.createObjectURL(file);
    set({ imageFile: file, imagePreviewUrl: url });
  }

  function removeImage() {
    if (value.imagePreviewUrl) URL.revokeObjectURL(value.imagePreviewUrl);
    set({ imageFile: null, imagePreviewUrl: null });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // 바이트 + 타입
  const fullContent = value.content + (value.optOut ? `\n${value.optOutText}` : "");
  const bytes = calcBytes(fullContent);
  const msgType: MsgType = getMsgType(value.channel, bytes, !!value.imagePreviewUrl);
  const estimatedCost = estimatedCount != null
    ? calcCost(msgType, estimatedCount)
    : null;

  // 수신거부 의무: 광고성 SMS는 필수 (카카오 알림톡은 선택)
  const isAdChannel = value.channel === "sms" || value.channel === "both";

  return (
    <div className="grid grid-cols-[1fr_auto] gap-5 items-start">
      {/* ── 왼쪽: 작성 폼 ─────────────────────────────── */}
      <div className="space-y-4">

        {/* 채널 선택 */}
        {!hideChannel && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">발송 채널</p>
            <div className="grid grid-cols-2 gap-2">
              {CHANNEL_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => set({ channel: opt.value })}
                  className={cn(
                    "rounded-lg border p-2.5 text-left text-sm transition-all",
                    value.channel === opt.value
                      ? "border-primary bg-primary/5 text-primary font-medium"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  )}
                >
                  <span className="block font-medium">{opt.label}</span>
                  <span className="text-[11px] opacity-70">{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 야간 경고 */}
        {nightTime && (
          <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5">
            <Clock className="size-4 text-warning shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-warning">야간 발송 주의 (현재 KST 기준 야간)</p>
              <p className="text-xs text-warning/80">광고성 문자는 오전 8시~오후 9시 사이에만 발송해야 합니다 (정보통신망법).</p>
            </div>
          </div>
        )}

        {/* 메시지 작성 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">메시지 내용</p>
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <MessageSquare className="size-3" />
              {showTemplates ? "직접 입력" : "템플릿 불러오기"}
            </button>
          </div>

          {/* 템플릿 목록 */}
          {showTemplates && (
            <div className="rounded-lg border border-border bg-muted/30 p-2 space-y-1 max-h-40 overflow-y-auto">
              {templates.filter(t => t.is_active).length === 0
                ? <p className="text-xs text-muted-foreground p-1">저장된 템플릿이 없습니다</p>
                : templates.filter(t => t.is_active).map(t => (
                  <button key={t.id} onClick={() => applyTemplate(t)}
                    className="w-full text-left rounded-md border border-border bg-background px-3 py-2 hover:border-primary/40 transition-all">
                    <p className="text-xs font-medium">{t.name}</p>
                    <p className="text-[11px] text-muted-foreground line-clamp-1">{t.content}</p>
                  </button>
                ))}
            </div>
          )}

          {/* 변수 칩 */}
          <div className="flex flex-wrap gap-1.5">
            {VAR_CHIPS.map(v => (
              <button key={v} onClick={() => insertVar(v)}
                className="rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors">
                {v}
              </button>
            ))}
          </div>

          {/* 텍스트 에어리어 */}
          <textarea
            rows={5}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
            placeholder={"안녕하세요 #{회원명}님!\n#{지점명}입니다.\n\n공지 내용을 입력하세요."}
            value={value.content}
            onChange={e => set({ content: e.target.value })}
          />

          {/* 바이트 카운터 + 타입 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                msgType === "SMS"   ? "bg-blue-50 text-blue-700" :
                msgType === "LMS"   ? "bg-amber-50 text-amber-700" :
                msgType === "MMS"   ? "bg-purple-50 text-purple-700" :
                "bg-yellow-50 text-yellow-700"
              )}>
                {msgType}
              </span>
              <span className="text-[11px] text-muted-foreground">{bytes}바이트</span>
              {msgType === "LMS" && (
                <span className="text-[11px] text-amber-600">장문 (90바이트 초과)</span>
              )}
            </div>
            {value.content && (
              <button onClick={() => set({ content: "" })} className="text-[11px] text-muted-foreground hover:text-danger">
                내용 지우기
              </button>
            )}
          </div>
        </div>

        {/* 이미지 첨부 (MMS) */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            이미지 첨부 <span className="normal-case font-normal text-muted-foreground/60">(MMS — 최대 300KB)</span>
          </p>
          {value.imagePreviewUrl ? (
            <div className="relative inline-block">
              <img src={value.imagePreviewUrl} alt="첨부 이미지" className="h-28 rounded-lg border border-border object-cover" />
              <button
                onClick={removeImage}
                className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-danger text-white flex items-center justify-center hover:bg-danger/80 transition-colors"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors w-full"
            >
              <ImagePlus className="size-4" />
              <span>이미지 추가 (jpg, png, gif)</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif"
            className="sr-only"
            onChange={handleImageChange}
          />
        </div>

        {/* 수신거부 문구 */}
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div className="flex items-center gap-2">
              {value.optOut
                ? <ToggleRight className="size-5 text-primary shrink-0" />
                : <ToggleLeft className="size-5 text-muted-foreground shrink-0" />}
              <span className="text-sm font-medium text-foreground">수신거부 문구 포함</span>
              {isAdChannel && !value.optOut && (
                <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] text-danger font-medium">
                  광고 SMS 필수
                </span>
              )}
            </div>
            <input type="checkbox" className="sr-only" checked={value.optOut} onChange={e => set({ optOut: e.target.checked })} />
          </label>

          {value.optOut && (
            <input
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
              value={value.optOutText}
              onChange={e => set({ optOutText: e.target.value })}
              placeholder="무료거부 080-XXX-XXXX"
            />
          )}

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            광고성 SMS는 수신거부 번호 포함이 <strong>법적 의무</strong>입니다 (정보통신망법 제50조).
            카카오 알림톡은 자동 포함됩니다.
          </p>
        </div>

        {/* 발송 예상 비용 */}
        {estimatedCount != null && estimatedCount > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Coins className="size-4" />
              예상 발송 비용
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-foreground">
                약 {estimatedCost?.toLocaleString()}원
              </p>
              <p className="text-[11px] text-muted-foreground">
                {estimatedCount}명 × {calcCost(msgType, 1)}원/{msgType}
              </p>
            </div>
          </div>
        )}

        {/* 추가 슬롯 (버튼 등) */}
        {children}
      </div>

      {/* ── 오른쪽: 폰 미리보기 ──────────────────────── */}
      <div className="sticky top-4 pt-6">
        <p className="text-[11px] text-center text-muted-foreground mb-2">미리보기</p>
        <SmsPhonePreview
          content={value.content}
          channel={value.channel}
          senderName={senderName}
          senderPhone={senderPhone}
          optOutText={value.optOut ? value.optOutText : null}
          imagePreviewUrl={value.imagePreviewUrl}
        />
      </div>
    </div>
  );
}

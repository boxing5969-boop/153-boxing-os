/**
 * 실시간 SMS/LMS/MMS/카카오 미리보기 — 스마트폰 프레임 렌더링
 */
import { useMemo } from "react";
import { Image } from "lucide-react";
import type { MsgChannel } from "@/services/messaging";

// ── 바이트 계산 (EUC-KR 기준: 한글 2byte, ASCII 1byte) ─────────────
export function calcBytes(text: string): number {
  let count = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    count += code > 127 ? 2 : 1;
  }
  return count;
}

export type MsgType = "SMS" | "LMS" | "MMS" | "KAKAO";

export function getMsgType(channel: MsgChannel, bytes: number, hasImage: boolean): MsgType {
  if (channel === "kakao" || channel === "kakao_sms_fallback") return "KAKAO";
  if (hasImage) return "MMS";
  return bytes > 90 ? "LMS" : "SMS";
}

// 단가 (원/건, 알리고 기준 — VAT 포함)
const UNIT_PRICE: Record<MsgType, number> = {
  SMS: 9,    // 알리고 8.4원
  LMS: 28,   // 알리고 25원
  MMS: 66,   // 알리고 60원
  KAKAO: 5,  // 알리고 4.8원
};

export function calcCost(type: MsgType, count: number): number {
  return UNIT_PRICE[type] * count;
}

// 변수 치환 (샘플 데이터)
const SAMPLE_VARS: Record<string, string> = {
  "#{회원명}":  "이용희",
  "#{지점명}":  "153복싱짐 강남점",
  "#{플랜명}":  "3개월 복싱",
  "#{만료일}":  "2026-06-16",
  "#{남은일수}": "7",
};

export function substitutePreview(content: string): string {
  let result = content;
  for (const [key, val] of Object.entries(SAMPLE_VARS)) {
    result = result.replaceAll(key, val);
  }
  return result;
}

// ── 타입 배지 색상 ────────────────────────────────────────────────────
const TYPE_BADGE: Record<MsgType, { bg: string; text: string; label: string }> = {
  SMS:   { bg: "#dbeafe", text: "#1d4ed8", label: "SMS" },
  LMS:   { bg: "#fef3c7", text: "#b45309", label: "LMS" },
  MMS:   { bg: "#ede9fe", text: "#6d28d9", label: "MMS" },
  KAKAO: { bg: "#fef9c3", text: "#a16207", label: "카카오" },
};

interface Props {
  content: string;
  channel: MsgChannel;
  senderName?: string;       // 발신자 이름
  senderPhone?: string;      // 발신 번호
  optOutText?: string | null;// 수신거부 문구 (null이면 미포함)
  imagePreviewUrl?: string | null;
  className?: string;
}

export default function SmsPhonePreview({
  content,
  channel,
  senderName = "153복싱짐",
  senderPhone = "15991999",
  optOutText,
  imagePreviewUrl,
  className = "",
}: Props) {
  const previewText = useMemo(() => substitutePreview(content), [content]);
  const bytes = useMemo(() => calcBytes(content + (optOutText ?? "")), [content, optOutText]);
  const msgType = getMsgType(channel, bytes, !!imagePreviewUrl);
  const badge = TYPE_BADGE[msgType];

  const isKakao = msgType === "KAKAO";

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      {/* 폰 프레임 */}
      <div style={{
        width: 210,
        background: "#1c1c1e",
        borderRadius: 34,
        padding: "8px 7px",
        boxShadow: "0 0 0 1.5px #3a3a3c, 0 8px 30px rgba(0,0,0,0.25)",
      }}>
        {/* 노치 */}
        <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 4px" }}>
          <div style={{ width: 62, height: 11, background: "#2c2c2e", borderRadius: 8 }} />
        </div>

        {/* 화면 영역 */}
        <div style={{
          background: isKakao ? "#b2c7d9" : "#f2f2f7",
          borderRadius: 26,
          minHeight: 380,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          {/* 상단 헤더 */}
          <div style={{
            background: isKakao ? "#3c6e8e" : "#fff",
            borderBottom: "0.5px solid rgba(0,0,0,0.08)",
            padding: "8px 12px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}>
            {isKakao ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: 26, height: 26, background: "#fee500", borderRadius: 6,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 700,
                }}>K</div>
                <span style={{ fontSize: 12, color: "#fff", fontWeight: 600 }}>{senderName}</span>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>문자 메시지</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>
                  {senderPhone}
                </div>
                <div style={{ fontSize: 10, color: "#888" }}>{senderName}</div>
              </>
            )}
          </div>

          {/* 메시지 버블 영역 */}
          <div style={{ flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
            {/* 시간 레이블 */}
            <div style={{ textAlign: "center", fontSize: 10, color: "#888", marginBottom: 2 }}>
              오전 10:30
            </div>

            {/* 메시지 말풍선 */}
            <div style={{
              background: isKakao ? "#fff" : "#fff",
              borderRadius: isKakao ? 12 : "14px 14px 14px 4px",
              padding: "10px 11px",
              fontSize: 11.5,
              lineHeight: 1.65,
              color: "#1a1a1a",
              maxWidth: "90%",
              wordBreak: "break-all",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            }}>
              {/* 이미지 (MMS) */}
              {imagePreviewUrl ? (
                <div style={{ marginBottom: 8 }}>
                  <img
                    src={imagePreviewUrl}
                    alt="첨부 이미지"
                    style={{ width: "100%", borderRadius: 8, maxHeight: 120, objectFit: "cover" }}
                  />
                </div>
              ) : null}

              {/* 카카오 제목 */}
              {isKakao && (
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a", marginBottom: 6 }}>
                  {senderName}
                </div>
              )}

              {/* 본문 */}
              {previewText ? (
                <span style={{ whiteSpace: "pre-wrap" }}>{previewText}</span>
              ) : (
                <span style={{ color: "#bbb", fontStyle: "italic" }}>메시지를 입력하세요...</span>
              )}

              {/* 수신거부 문구 */}
              {optOutText && (
                <div style={{ marginTop: 8, paddingTop: 6, borderTop: "0.5px solid #e0e0e0", fontSize: 10, color: "#888" }}>
                  {optOutText}
                </div>
              )}
            </div>

            {/* 카카오 버튼 영역 */}
            {isKakao && previewText && (
              <div style={{
                background: "#fff",
                borderRadius: "0 0 12px 12px",
                borderTop: "0.5px solid #e8e8e8",
                padding: "6px 11px",
                fontSize: 11,
                color: "#3e8ed0",
                textAlign: "center",
                maxWidth: "90%",
              }}>
                자세히 보기
              </div>
            )}

            {/* 전송 시각 */}
            <div style={{ fontSize: 9.5, color: "#bbb", marginLeft: 4 }}>오전 10:30</div>
          </div>
        </div>

        {/* 홈 바 */}
        <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 2px" }}>
          <div style={{ width: 52, height: 4, background: "#48484a", borderRadius: 4 }} />
        </div>
      </div>

      {/* 타입 배지 + 바이트 표시 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          background: badge.bg, color: badge.text,
          borderRadius: 6, padding: "2px 8px",
          fontSize: 11, fontWeight: 600,
        }}>
          {badge.label}
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
          {bytes}바이트
        </span>
      </div>
    </div>
  );
}

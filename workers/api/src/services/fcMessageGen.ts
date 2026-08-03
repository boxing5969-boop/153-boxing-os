/**
 * FC AI 메시지 생성 — V2 (카피 업그레이드)
 * LLM(Anthropic) 우선, 키 미설정·오류 시 규칙 기반으로 자동 폴백.
 * V2 원칙("다정한 엘리트 코치" 톤·실제 데이터만·CTA 1개·상투어 금지·의료/허위혜택 금지)을
 * 시스템 프롬프트에 포함한다. 규칙 폴백도 V2 금지 상투어를 쓰지 않고 INFO(정보성)로만 작성한다.
 * 생성 결과는 DB 안전검증(check_message_safety)을 다시 거치고, 발송 경로(fc.ts)에서
 * info/ad 분류·동의·발송시간·광고표기·suppress·cooldown를 추가로 강제한다.
 */
import type { Env } from "../lib/env";

export interface MemberContext {
  member_name: string;
  branch_name: string;
  product_type?: string | null;
  lifecycle_stage?: string | null;
  days_since_last_visit?: number | null;
  days_until_expiry?: number | null;
  reason?: string | null;
}

export interface GenResult {
  text: string;
  mode: "llm" | "rule";
}

const SAFETY_GUIDE = `당신은 153복싱짐 회원 케어 담당자입니다. 목소리는 "다정한 엘리트 코치"입니다. 회원의 실제 기록을 알아보고, 다음 운동을 가장 쉽게 만들어 주는 한 통의 문자를 작성합니다.

[톤]
- 감동은 감성적 미사여구가 아니라, 회원의 실제 데이터를 알아보고 불편을 먼저 줄여주는 데서 나온다.
- 할인보다 "지금까지 만든 리듬", "다음 목표", "개인 일정에 맞춘 방식"을 말한다.
- 대량문자처럼 보이는 상투어와 근거 없는 친밀감을 쓰지 않는다.

[절대 금지]
- 체중·뱃살·몸매·외모·비만·다이어트 등 신체/외모에 대한 언급.
- 질병·부상·건강상태를 단정하거나 의료적 효과를 주장하는 표현.
- "마지막 기회", "지금 당장", "안 하면 후회" 같은 압박·불안 조성 표현.
- 회원을 평가하거나 탓하는 표현.
- 확인되지 않은 혜택·가격·할인·마감일을 지어내는 것. (제공되지 않은 값은 쓰지 않는다)
- 상투어 금지: "오랜만이에요", "요즘 많이 바쁘셨죠", "자리는 늘 준비되어 있어요" 같은 뻔한 인사.

[형식]
- 한국어, 2~3문장, 카카오/문자 발송용으로 간결하게.
- 연락한 이유가 첫 문장에 드러나게 한다.
- CTA(다음 행동)는 정확히 1개만. 답장 부담이 낮아야 한다.
- 실제로 제공된 데이터만 말한다(이름·지점·상품·만료일 등). 모르는 값은 언급하지 않는다.
- 이모지는 최대 1개까지만.
- 메시지 본문만 출력하고 머리말·설명을 붙이지 않는다.`;

/** 회원 맥락으로 케어 메시지 생성 */
export async function generateFcMessage(
  env: Env,
  ctx: MemberContext,
): Promise<GenResult> {
  if (env.ANTHROPIC_API_KEY) {
    try {
      const text = await callAnthropic(env.ANTHROPIC_API_KEY, ctx);
      if (text && text.trim()) return { text: text.trim(), mode: "llm" };
    } catch (e) {
      console.error("[fcMessageGen] LLM 실패 — 규칙 기반 폴백:", e);
    }
  }
  return { text: ruleBasedMessage(ctx), mode: "rule" };
}

// ── LLM 호출 ──────────────────────────────────────────────────
async function callAnthropic(apiKey: string, ctx: MemberContext): Promise<string> {
  const lines = [
    `회원 이름: ${ctx.member_name}`,
    `지점: ${ctx.branch_name}`,
    ctx.product_type ? `이용 상품: ${ctx.product_type}` : "",
    ctx.lifecycle_stage ? `회원 단계: ${ctx.lifecycle_stage}` : "",
    ctx.days_since_last_visit != null
      ? `마지막 방문 후 ${ctx.days_since_last_visit}일 경과` : "",
    ctx.days_until_expiry != null
      ? `회원권 만료까지 ${ctx.days_until_expiry}일` : "",
    ctx.reason ? `연락 사유: ${ctx.reason}` : "",
    "",
    "위 회원에게 보낼 케어 메시지를 작성해줘.",
  ].filter(Boolean);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: SAFETY_GUIDE,
      messages: [{ role: "user", content: lines.join("\n") }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  return json.content?.find((b) => b.type === "text")?.text ?? "";
}

// ── 규칙 기반 폴백 ────────────────────────────────────────────
function ruleBasedMessage(ctx: MemberContext): string {
  const name = ctx.member_name;
  const branch = ctx.branch_name;
  const ls = ctx.lifecycle_stage ?? "";

  // 재등록 단계 — 권유(광고성)가 아니라 '이용 기간 정보 고지'로만. 동의·광고표기 없이 권유하지 않는다.
  if (ls.startsWith("renewal")) {
    const d = ctx.days_until_expiry;
    // 안전가드: 이미 만료된(d<0) 회원에겐 '곧/약 N일 뒤 종료' 류 임박 문구 금지 → 복귀/재등록 안내로 전환
    if (d != null && d < 0) {
      return `[${branch}] ${name}님, 이용 기간이 종료된 지 ${-d}일 됐습니다. ` +
        `다시 이어가고 싶으실 때 편하게 연락 주시면 부담 없이 도와드리겠습니다.`;
    }
    const when = d != null ? `약 ${d}일 뒤` : "곧";
    return `[${branch}] ${name}님, 현재 이용 기간이 ${when} 종료될 예정입니다. ` +
      `남은 이용 일정이나 휴회·변경 사항 확인이 필요하시면 센터로 편하게 연락 주세요.`;
  }
  // 휴면·출석 둔화 — 비난 없이 복귀 장벽을 낮춘다 (winback_active_d15 톤)
  if (ls === "dormant" || ls === "attendance_risk") {
    const d = ctx.days_since_last_visit;
    const gap = d != null ? `마지막 운동 후 ${d}일이 지나 ` : "";
    return `[${branch}] ${name}님, ${gap}가볍게 안부 드립니다. ` +
      `다시 오시는 날은 컨디션에 맞춰 강도를 낮춰 부담 없이 시작하겠습니다. ` +
      `이번 주 가능한 요일이 있으면 편하게 알려주세요.`;
  }
  // 신규 — 첫 2주는 리듬 만들기 (onboarding_welcome 톤)
  if (ls.startsWith("new")) {
    return `[${branch}] ${name}님, 153복싱짐에 오신 것을 환영합니다. ` +
      `처음 2주는 잘하는 것보다 편하게 리듬을 만드는 데 집중하겠습니다. ` +
      `첫 운동 준비가 궁금하시면 센터로 편하게 연락 주세요.`;
  }
  // 활성·기본 — 노력 인정 + 개선 의견 한 가지 (consistent_feedback 톤)
  return `[${branch}] ${name}님, 꾸준히 함께해 주셔서 감사합니다. ` +
    `수업이나 시설에서 더 좋아졌으면 하는 점이 한 가지 있으면 편하게 알려주세요. ` +
    `작은 부분도 바로 확인하겠습니다.`;
}

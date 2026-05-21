/**
 * FC AI 메시지 생성 — 4차
 * LLM(Anthropic) 우선, 키 미설정·오류 시 규칙 기반으로 자동 폴백.
 * 안전 가이드라인(외모/체중 언급 금지, 압박 표현 금지)을 프롬프트에 포함한다.
 * 생성 결과는 DB 안전검증(check_message_safety)을 다시 거친다.
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

const SAFETY_GUIDE = `당신은 피트니스 센터의 회원 케어 담당자입니다. 회원에게 보낼 따뜻한 안내 메시지를 작성합니다.

반드시 지켜야 할 규칙:
- 체중·뱃살·몸매·외모·비만·다이어트 등 신체나 외모에 대한 언급을 절대 하지 않는다.
- "마지막 기회", "지금 당장", "안 하면 후회" 같은 압박하거나 불안을 조성하는 표현을 쓰지 않는다.
- 회원을 존중하며 따뜻하고 격려하는 톤으로 쓴다.
- 한국어로, 2~3문장으로 간결하게 쓴다 (카카오톡/문자 발송용).
- 이모지는 최대 1개까지만 사용한다.
- 메시지 본문만 출력하고 다른 설명·머리말은 붙이지 않는다.`;

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

  if (ls.startsWith("renewal")) {
    const d = ctx.days_until_expiry;
    return `[${branch}] ${name}님, 안녕하세요! 회원권 만료가 ` +
      `${d != null ? `${d}일 앞으로 ` : ""}다가오고 있어요. ` +
      `편하실 때 연장 상담 도와드릴게요. 궁금한 점 있으면 언제든 연락 주세요 :)`;
  }
  if (ls === "dormant" || ls === "attendance_risk") {
    return `[${branch}] ${name}님, 오랜만이에요! 요즘 많이 바쁘셨죠? ` +
      `${name}님 자리는 늘 준비되어 있어요. 가볍게 다시 시작해보면 어떨까요? ` +
      `함께 응원하겠습니다.`;
  }
  if (ls.startsWith("new")) {
    return `[${branch}] ${name}님, 등록을 환영합니다! 처음엔 누구나 어색하지만 ` +
      `한 걸음씩 함께 가면 됩니다. 도움이 필요하면 언제든 코치에게 말씀해주세요.`;
  }
  return `[${branch}] ${name}님, 안녕하세요! 늘 꾸준히 함께해주셔서 감사해요. ` +
    `운동하시면서 불편한 점이나 궁금한 점 있으면 편하게 말씀해주세요 :)`;
}

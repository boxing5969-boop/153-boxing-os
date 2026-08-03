// VIP 초대장 공통 로직 — 서버/DB 불필요, 링크(#d=)에 데이터 인코딩.
// 출입/회원 DB와 무관한 순수 회원 커뮤니케이션 기능.
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { presetByKey, presetToFull } from "./vipPresets";

export interface VipData {
  n: string; // 이름
  r: string; // 수상(한글) 예: 우승
  re: string; // 수상(영문 뱃지) 예: CHAMPION
  no: string; // 증서번호 예: FF7-08
  d: string; // 발급일 2026.07.01
  v: string; // 사용기간
  ev: string; // 대회/이벤트명
  br: string; // 지점(한글)
  brEn: string; // 지점(영문)
  gymEn: string;
  coh: string; // Certificate of Honor
  title: string; // FOUNDING FIGHTER
  roman: string; // VII
  disc: string | number; // 할인율
  guestN: string | number; // 게스트 초대권 매수
  guestEach: string;
  guestTotal: string;
  amb: [string, string][];
  benefits: string[];
  conds: string[];
  tel: string;
  sign: string;
  closing: string;
  noPrefix?: string;
  L: string[]; // 편지 문단
}

export const DEFAULTS = {
  gymEn: "153 BOXING",
  brEn: "SEOLLEUNG",
  br: "선릉역점",
  title: "FOUNDING FIGHTER",
  roman: "VII",
  coh: "Certificate of Honor",
  ev: "오픈 첫 생활체육대회",
  disc: 20,
  guestN: 2,
  guestEach: "30,000",
  guestTotal: "60,000",
  amb: [
    ["1개월", "게스트 1개월 등록 시 — VIP 회원 7일 + 게스트 7일 연장"],
    ["3개월", "게스트 3개월 등록 시 — VIP 회원 15일 + 게스트 15일 연장"],
    ["5+개월", "게스트 5개월 이상 등록 시 — VIP 회원 1개월 + 게스트 1개월 연장"],
  ] as [string, string][],
  benefits: [
    "Champion Bonus Week 20% 할인권 · 본인 이용권 20% 할인",
    "VIP 게스트 초대권 2매 · 총 60,000원 상당",
    "다음 대회 준비반 우선 안내",
    "게스트 등록 시 VIP 회원 추가 연장",
    "153 Ambassador 혜택 · 등록 기간별 VIP·게스트 동시 연장",
  ],
  conds: [
    "혜택권은 발급일로부터 1년 이내 사용",
    "타 할인·이벤트와 중복 사용 불가",
    "현금 교환 및 양도 불가",
    "게스트 초대권은 첫 방문 고객에 한해 사용 가능",
  ],
  tel: "0507-1468-5969",
  closing: "다음 대회에서 또 만나요.",
  sign: "153복싱짐 선릉역점",
  noPrefix: "FF7-",
};

export function todayDot(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, ".");
}

export function plusYear(dot: string): string {
  const p = (dot || "").split(".").map(Number);
  const [y, mo, da] = p;
  if (!y || !mo || !da) return "";
  const dd = new Date(y + 1, mo - 1, da);
  dd.setDate(dd.getDate() - 1);
  const m = ("0" + (dd.getMonth() + 1)).slice(-2);
  const day = ("0" + dd.getDate()).slice(-2);
  return dd.getFullYear() + "." + m + "." + day;
}

export function autoLetter(name: string, rKo: string, ev: string, br: string): string[] {
  const champ = rKo.indexOf("준") === -1;
  if (champ) {
    return [
      `${br} ${ev}, 그 링 위에서 끝까지 물러서지 않은 ${name} 님의 모습을 저희는 오래 기억합니다. 그 용기가 ‘${rKo}’이라는 값진 결과로 남았습니다.`,
      `축하와 감사의 마음을 담아 153이 작은 선물을 준비했습니다. 아래 증서와 혜택은 ${name} 님을 위한 것입니다.`,
      "함께해 주셔서 진심으로 감사합니다. 다음 라운드도 153이 끝까지 곁을 지키겠습니다.",
    ];
  }
  return [
    `${br} ${ev}, 마지막 라운드까지 링을 지켜낸 ${name} 님의 그 마음이 결과보다 먼저 기억에 남았습니다. 끝까지 포기하지 않은 파이트로 ‘${rKo}’에 올랐습니다.`,
    `우승 못지않은 그 투지에 보답하고 싶어 153이 선물을 준비했습니다. 혜택은 우승자와 동일하게 담았습니다. 아래 증서와 혜택은 ${name} 님을 위한 것입니다.`,
    `오늘의 ${rKo}이 다음 무대의 출발선이 되리라 믿습니다. 그 길, 153이 끝까지 함께하겠습니다.`,
  ];
}

// 링크 축소: 기본값과 다른 값 + 자동편지와 다른 편지만 담는다.
export function buildMin(full: VipData): Record<string, unknown> {
  const min: Record<string, unknown> = {
    n: full.n, r: full.r, re: full.re, no: full.no, d: full.d, v: full.v,
  };
  const scalarKeys: (keyof typeof DEFAULTS)[] = [
    "ev", "br", "brEn", "gymEn", "coh", "title", "roman",
    "disc", "guestN", "guestEach", "guestTotal", "tel", "sign", "closing",
  ];
  for (const k of scalarKeys) {
    if ((full as unknown as Record<string, unknown>)[k] !== DEFAULTS[k]) {
      min[k] = (full as unknown as Record<string, unknown>)[k];
    }
  }
  const arrKeys: ("amb" | "benefits" | "conds")[] = ["amb", "benefits", "conds"];
  for (const k of arrKeys) {
    if (JSON.stringify(full[k]) !== JSON.stringify(DEFAULTS[k])) min[k] = full[k];
  }
  const auto = autoLetter(full.n, full.r, full.ev, full.br);
  if (JSON.stringify(full.L) !== JSON.stringify(auto)) min.L = full.L;
  return min;
}

export function encodeData(min: Record<string, unknown>): string {
  return compressToEncodedURIComponent(JSON.stringify(min));
}

export function decodeData(raw: string): VipData | null {
  try {
    const obj = JSON.parse(decompressFromEncodedURIComponent(raw) || "null");
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    // 짧은 링크: 프리셋 키(p)로 편지·혜택을 서버 없이 재구성
    if (typeof o.p === "string") {
      const preset = presetByKey(o.p);
      const g = (k: string, d: string): string => (o[k] !== undefined ? String(o[k]) : d);
      const base = {
        n: g("n", ""), no: g("no", "—"), d: g("d", todayDot()), v: g("v", ""),
        r: g("r", preset.awardKo), re: g("re", preset.awardEn),
        br: g("br", DEFAULTS.br), brEn: g("brEn", DEFAULTS.brEn), gymEn: g("gymEn", DEFAULTS.gymEn),
        tel: g("tel", DEFAULTS.tel), sign: g("sign", DEFAULTS.sign),
      };
      const full = presetToFull(preset, base) as Record<string, unknown>;
      for (const k of ["ev", "title", "roman", "coh", "disc", "guestN", "guestEach", "guestTotal", "closing", "benefits", "conds", "amb", "L"]) {
        if (o[k] !== undefined) full[k] = o[k];
      }
      return full as unknown as VipData;
    }
    const merged = { ...DEFAULTS, ...o } as unknown as VipData;
    if (!merged.L || !merged.L.length) merged.L = autoLetter(merged.n, merged.r, merged.ev, merged.br);
    return merged;
  } catch {
    return null;
  }
}

export function inviteLink(min: Record<string, unknown>): string {
  const base = window.location.origin + "/vip";
  return base + "#d=" + encodeData(min);
}

export function kakaoMessage(d: VipData, link: string): string {
  const champ = d.r.indexOf("준") === -1;
  const head = `${d.n} 님, 값진 ${d.r}을 진심으로 축하드립니다.`;
  const body = champ
    ? "153이 준비한 작은 선물을 보내드려요. 편지와 VIP 혜택이 담겨 있으니 천천히 열어봐 주세요."
    : "우승 못지않은 그 파이트에 작은 선물을 준비했어요. 혜택은 우승자와 똑같이 담았습니다. 천천히 열어봐 주세요.";
  return `${head}\n${body}\n${link}\n— ${d.sign}`;
}

function esc(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 초대장 다크 블랙&골드 CSS (.vip-root 하위로 스코프)
export const INV_CSS = `
.vip-root{background:#0a0a0e;color:#ece7d9;font-family:'Noto Sans KR',-apple-system,sans-serif;line-height:1.85;-webkit-font-smoothing:antialiased;min-height:100vh}
.vip-root *{margin:0;padding:0;box-sizing:border-box}
.vip-root .wrap{max-width:500px;margin:0 auto;position:relative;background:radial-gradient(120% 60% at 50% 0%,rgba(212,175,55,.10),transparent 60%),radial-gradient(120% 50% at 50% 42%,rgba(212,175,55,.06),transparent 60%),linear-gradient(180deg,#0a0a0e,#101019 45%,#08080c);min-height:100vh;box-shadow:0 0 80px rgba(0,0,0,.6)}
.vip-root .cz{font-family:'Cinzel',serif}
.vip-root .gold{background:linear-gradient(180deg,#f7e9b6,#dcb84e 55%,#a9842b);-webkit-background-clip:text;background-clip:text;color:transparent}
.vip-root .eyebrow{font-family:'Cinzel',serif;letter-spacing:.34em;font-size:11px;color:#a9842b;text-transform:uppercase}
.vip-root section{padding:70px 30px;position:relative}
.vip-root .divider{display:flex;align-items:center;justify-content:center;gap:14px;margin:28px 0}
.vip-root .divider i{display:block;height:1px;width:60px;background:linear-gradient(90deg,transparent,#3a3320)}
.vip-root .divider i:last-child{background:linear-gradient(90deg,#3a3320,transparent)}
.vip-root .diamond{width:9px;height:9px;background:#dcb84e;transform:rotate(45deg);box-shadow:0 0 12px rgba(220,184,78,.5)}
.vip-root .emblem{width:96px;height:96px;border-radius:50%;border:1.6px solid #dcb84e;display:flex;align-items:center;justify-content:center;position:relative;margin:0 auto;box-shadow:0 0 28px rgba(220,184,78,.18),inset 0 0 18px rgba(220,184,78,.08)}
.vip-root .emblem::before{content:"";position:absolute;inset:7px;border-radius:50%;border:1px solid #3a3320}
.vip-root .emblem b{font-family:'Cinzel',serif;font-size:30px;font-weight:700}
.vip-root .emblem.sm{width:74px;height:74px}.vip-root .emblem.sm b{font-size:23px}
.vip-root .cover{min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px 30px}
.vip-root .cover .top{font-family:'Cinzel',serif;letter-spacing:.3em;font-size:12px;color:#a9842b;text-transform:uppercase;margin-bottom:34px}
.vip-root .cover .ff{font-family:'Cinzel',serif;font-weight:700;font-size:34px;line-height:1.18;letter-spacing:.06em;margin:26px 0 4px}
.vip-root .cover .vip{font-family:'Cinzel',serif;font-size:18px;letter-spacing:.4em;color:#a9842b}
.vip-root .cover .coh{font-family:'Cinzel',serif;letter-spacing:.3em;font-size:10.5px;color:#9b8f73;text-transform:uppercase;margin-top:8px}
.vip-root .cover .name{font-family:'Noto Serif KR',serif;font-weight:700;font-size:70px;letter-spacing:.04em;margin:6px 0 18px;line-height:1;background:linear-gradient(180deg,#fff4cf,#dcb84e 55%,#a9842b);-webkit-background-clip:text;background-clip:text;color:transparent}
.vip-root .badge{display:inline-flex;align-items:center;gap:9px;border:1.3px solid #dcb84e;border-radius:40px;padding:10px 22px;font-family:'Cinzel',serif;letter-spacing:.16em;font-size:13px;color:#f7e9b6}
.vip-root .badge .dot{width:5px;height:5px;border-radius:50%;background:#dcb84e}
.vip-root .cover .date{margin-top:22px;font-family:'Cinzel',serif;letter-spacing:.3em;font-size:12px;color:#9b8f73}
.vip-root .sec-h{text-align:center;margin-bottom:28px}
.vip-root .sec-h .kr{font-family:'Noto Serif KR',serif;font-size:24px;font-weight:600;margin-top:6px}
.vip-root .letter{border:1px solid #3a3320;border-radius:4px;padding:40px 26px;background:linear-gradient(180deg,rgba(220,184,78,.04),rgba(0,0,0,0))}
.vip-root .letter p{font-family:'Noto Serif KR',serif;font-size:16px;color:#ddd7c6;margin-bottom:16px;word-break:keep-all;line-height:2.02}
.vip-root .letter .to{font-family:'Noto Serif KR',serif;font-size:21px;color:#f7e9b6;margin-bottom:22px;font-weight:600}
.vip-root .letter .sign{margin-top:26px;text-align:right;font-family:'Noto Serif KR',serif;color:#9b8f73;font-size:14px}
.vip-root .letter .sign b{display:block;color:#dcb84e;font-size:15.5px;margin-top:4px;font-weight:600}
.vip-root .cert{border:1.4px solid #a9842b;border-radius:6px;padding:38px 24px 28px;text-align:center;background:linear-gradient(180deg,#0d0d14,#0a0a10);box-shadow:inset 0 0 40px rgba(0,0,0,.6)}
.vip-root .cert .ribbon{font-family:'Cinzel',serif;letter-spacing:.28em;font-size:10px;color:#9b8f73;text-transform:uppercase}
.vip-root .cert .big{font-family:'Cinzel',serif;font-weight:700;font-size:24px;line-height:1.2;letter-spacing:.04em;margin:12px 0 2px}
.vip-root .cert .vii{font-family:'Cinzel',serif;letter-spacing:.4em;color:#a9842b;font-size:15px}
.vip-root .cert .desc{font-family:'Noto Serif KR',serif;font-size:13.5px;color:#9b8f73;margin:18px 0 12px;word-break:keep-all}
.vip-root .cert .cname{font-family:'Noto Serif KR',serif;font-weight:700;font-size:44px;margin:6px 0 14px}
.vip-root .cert .foot{display:flex;justify-content:space-between;margin-top:24px;padding-top:15px;border-top:1px solid #2c2616;font-family:'Cinzel',serif;font-size:9.5px;letter-spacing:.1em;color:#9b8f73;text-transform:uppercase}
.vip-root .cert .foot div{flex:1}.vip-root .cert .foot .c{text-align:center}.vip-root .cert .foot .r{text-align:right}
.vip-root .cert .foot b{display:block;color:#c8bd9b;font-size:11px;margin-top:3px;letter-spacing:.05em}
.vip-root .coupon{position:relative;border:1px solid #3a3320;border-radius:10px;margin-bottom:20px;background:linear-gradient(180deg,#0e0e16,#0a0a11);overflow:hidden}
.vip-root .coupon .cap{padding:22px 22px 6px;text-align:center}
.vip-root .coupon .tag{font-family:'Cinzel',serif;letter-spacing:.24em;font-size:10px;color:#a9842b;text-transform:uppercase}
.vip-root .coupon .ttl{font-family:'Noto Serif KR',serif;font-size:17px;font-weight:600;margin-top:7px}
.vip-root .coupon .big{font-family:'Cinzel',serif;font-weight:700;font-size:58px;line-height:1;margin:6px 0 2px;background:linear-gradient(180deg,#fff4cf,#dcb84e 55%,#a9842b);-webkit-background-clip:text;background-clip:text;color:transparent}
.vip-root .coupon .big small{font-size:24px}
.vip-root .perf{position:relative;height:1px;margin:16px 0;border-top:1px dashed #3a3320}
.vip-root .perf::before,.vip-root .perf::after{content:"";position:absolute;top:-9px;width:18px;height:18px;border-radius:50%;background:#101019}
.vip-root .perf::before{left:-9px}.vip-root .perf::after{right:-9px}
.vip-root .coupon .body{padding:4px 22px 20px}
.vip-root .stub{display:flex;gap:12px}
.vip-root .stub .s{flex:1;border:1px solid #2c2616;border-radius:8px;text-align:center;padding:15px 8px}
.vip-root .stub .s .v{font-family:'Cinzel',serif;font-size:24px;font-weight:700;color:#f7e9b6}
.vip-root .stub .s .l{font-family:'Cinzel',serif;font-size:9px;letter-spacing:.2em;color:#9b8f73;margin-top:4px}
.vip-root .kv{display:flex;justify-content:space-between;font-size:12.5px;color:#9b8f73;margin-top:9px}
.vip-root .kv b{color:#cabf9c;font-weight:500}
.vip-root .amb-row{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #2c2616}
.vip-root .amb-row:last-child{border-bottom:0}
.vip-root .amb-row .m{font-family:'Cinzel',serif;color:#dcb84e;font-size:13px;min-width:52px;font-weight:600}
.vip-root .amb-row .t{font-size:12.5px;color:#cdc4a9;word-break:keep-all}
.vip-root .note{font-size:11px;color:#6f6750;text-align:center;margin-top:6px;word-break:keep-all}
.vip-root .b-row{display:flex;gap:14px;padding:12px 0;border-bottom:1px solid #2c2616}
.vip-root .b-row .n{font-family:'Cinzel',serif;color:#a9842b;font-size:13px;min-width:26px}
.vip-root .b-row .t{font-size:13.5px;color:#d6cdb2;word-break:keep-all}
.vip-root .cond{margin-top:20px;border:1px solid #2c2616;border-radius:8px;padding:16px 18px}
.vip-root .cond li{list-style:none;font-size:12px;color:#9b8f73;padding-left:15px;position:relative;margin:6px 0;word-break:keep-all}
.vip-root .cond li::before{content:"·";position:absolute;left:3px;color:#a9842b}
.vip-root .savebtn{display:block;width:100%;margin-top:12px;border:1.2px solid #dcb84e;background:rgba(220,184,78,.06);color:#f7e9b6;border-radius:8px;padding:12px;font-family:'Noto Sans KR',sans-serif;font-size:13.5px;font-weight:500;cursor:pointer}
.vip-root .sharebtn{display:block;width:100%;margin-top:14px;border:0;background:linear-gradient(180deg,#f0dc9a,#dcb84e 55%,#b8912f);color:#20180a;border-radius:8px;padding:15px;font-family:'Noto Sans KR',sans-serif;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 6px 20px rgba(220,184,78,.22)}
.vip-root .fnd{border:1.4px solid #a9842b;border-radius:8px;padding:32px 22px 24px;text-align:center;background:linear-gradient(180deg,#12100a,#0a0a10);box-shadow:inset 0 0 40px rgba(0,0,0,.6)}
.vip-root .fnd .tag{font-family:'Cinzel',serif;letter-spacing:.26em;font-size:10px;color:#9b8f73;text-transform:uppercase;margin-top:12px}
.vip-root .fnd .ttl{font-family:'Cinzel',serif;font-weight:700;font-size:22px;line-height:1.2;letter-spacing:.04em;margin:10px 0 0}
.vip-root .fnd .krt{font-family:'Noto Serif KR',serif;font-size:16px;font-weight:600;color:#f7e9b6;margin-top:6px}
.vip-root .fnd .desc{font-family:'Noto Serif KR',serif;font-size:13.5px;color:#9b8f73;margin:16px 0 4px;word-break:keep-all}
.vip-root .fnd .host{font-family:'Noto Serif KR',serif;font-weight:700;font-size:34px;margin:2px 0 16px}
.vip-root .fnd .amb-row{text-align:left}
.vip-root .fnd .steps{text-align:left;margin-top:18px;border-top:1px solid #2c2616;padding-top:14px}
.vip-root .fnd .steps .st{font-size:12.5px;color:#cdc4a9;margin:8px 0;padding-left:22px;position:relative;word-break:keep-all;line-height:1.7}
.vip-root .fnd .steps .st b{position:absolute;left:0;top:0;color:#dcb84e;font-family:'Cinzel',serif;font-weight:700}
.vip-root .fnd .foot{display:flex;justify-content:space-between;margin-top:20px;padding-top:14px;border-top:1px solid #2c2616;font-family:'Cinzel',serif;font-size:9.5px;letter-spacing:.1em;color:#9b8f73;text-transform:uppercase}
.vip-root .fnd .foot div{flex:1}.vip-root .fnd .foot .c{text-align:center}.vip-root .fnd .foot .r{text-align:right}
.vip-root .fnd .foot b{display:block;color:#c8bd9b;font-size:11px;margin-top:3px;letter-spacing:.05em}
.vip-root .closing{text-align:center;padding-bottom:80px}
.vip-root .closing .msg{font-family:'Noto Serif KR',serif;font-size:20px;color:#f7e9b6;margin:12px 0 6px}
.vip-root .closing .sub{font-size:13px;color:#9b8f73;word-break:keep-all}
.vip-root .cta{display:inline-block;margin-top:24px;border:1.3px solid #dcb84e;border-radius:40px;padding:13px 28px;color:#f7e9b6;text-decoration:none;font-family:'Noto Serif KR',serif;font-size:15px}
.vip-root .foot-brand{margin-top:36px;font-family:'Cinzel',serif;letter-spacing:.22em;font-size:10px;color:#5f5740;text-transform:uppercase}
.vip-root.capturing .gold,.vip-root.capturing .name,.vip-root.capturing .cert .cname,.vip-root.capturing .coupon .big{-webkit-text-fill-color:#e8c96a !important;color:#e8c96a !important;background:none !important}
.vip-root.capturing .savebtn,.vip-root.capturing .sharebtn{visibility:hidden}
`;

export function invitationHTML(d: VipData): string {
  const paras = (d.L || []).map((p) => `<p>${esc(p)}</p>`).join("");
  const amb = (d.amb || []).map((r) => `<div class="amb-row"><div class="m">${esc(r[0])}</div><div class="t">${esc(r[1])}</div></div>`).join("");
  const roman = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const ben = (d.benefits || []).map((t, i) => `<div class="b-row"><div class="n">${roman[i] || i + 1}</div><div class="t">${esc(t)}</div></div>`).join("");
  const cond = (d.conds || []).map((t) => `<li>${esc(t)}</li>`).join("");
  let stubs = "";
  const gn = Number(d.guestN) || 0;
  for (let i = 0; i < gn; i++) stubs += `<div class="s"><div class="v">${esc(d.guestEach)}₩</div><div class="l">GUEST · 0${i + 1}</div></div>`;
  return `<div class="wrap">
<section class="cover">
<div class="top">${esc(d.gymEn)} &nbsp;◆&nbsp; ${esc(d.brEn)}</div>
<div class="emblem"><b class="gold">153</b></div>
<div class="coh">${esc(d.coh)}</div>
<div class="ff gold">${esc(d.title).replace(/ /g, "<br>")}</div>
${d.roman ? `<div class="vip">VIP &nbsp;${esc(d.roman)}</div>` : ""}
<div class="divider"><i></i><span class="diamond"></span><i></i></div>
<div class="name">${esc(d.n)}</div>
<div class="badge"><span class="dot"></span><span class="cz">${esc(d.re)} · ${esc(d.r)}</span></div>
<div class="date">${esc(d.d)}</div>
</section>
<section><div class="sec-h"><div class="eyebrow">A Letter For You</div><div class="kr">감사의 편지</div></div>
<div class="letter"><div class="to">${esc(d.n)} 님께</div>${paras}
<div class="sign">진심을 담아<b>${esc(d.sign)}</b></div></div></section>
<section><div class="sec-h"><div class="eyebrow">Certificate</div><div class="kr">명예 증서</div></div>
<div class="cert" id="cap-cert"><div class="emblem sm"><b class="gold">153</b></div>
<div class="ribbon" style="margin-top:12px">${esc(d.coh)}</div>
<div class="big gold">${esc(d.title)}</div>${d.roman ? `<div class="vii">VIP &nbsp;${esc(d.roman)}</div>` : ""}
<div class="desc">${esc(d.br)} ${esc(d.ev)}를<br>빛낸 회원님께 이 증서를 드립니다</div>
<div class="cname gold">${esc(d.n)}</div>
<div class="badge"><span class="dot"></span><span class="cz">${esc(d.re)} · ${esc(d.r)}</span></div>
<div class="foot"><div>Issued<b>${esc(d.d)}</b></div><div class="c">Seal<b>153 · ${esc(d.brEn)}</b></div><div class="r">No.<b>${esc(d.no)}</b></div></div></div>
<button class="savebtn" data-cap="cap-cert" data-fn="명예증서">명예 증서 이미지 저장</button></section>
<section><div class="sec-h"><div class="eyebrow">Member Benefits</div><div class="kr">VIP 혜택</div></div>
<div class="coupon" id="cap-disc"><div class="cap"><div class="tag">Champion Bonus Week</div><div class="big">${esc(d.disc)}<small>%</small></div><div class="ttl">본인 이용권 ${esc(d.disc)}% 할인권</div></div>
<div class="perf"></div><div class="body"><div class="kv"><span>회원</span><b>${esc(d.n)} · ${esc(d.r)}</b></div>
<div class="kv"><span>사용기간</span><b>${esc(d.v)}</b></div><div class="kv"><span>증서번호</span><b>${esc(d.no)}</b></div>
<div class="note">타 할인·이벤트와 중복 불가 · 현금 교환 및 양도 불가 · ${esc(d.br)} 사용</div></div></div>
<button class="savebtn" data-cap="cap-disc" data-fn="할인권">할인권 이미지 저장</button>
<div class="coupon" id="cap-guest" style="margin-top:20px"><div class="cap"><div class="tag">VIP Guest Invitation</div><div class="ttl" style="margin-top:8px">VIP 게스트 초대권 ${esc(d.guestN)}매</div><div class="note" style="margin-top:6px">총 ${esc(d.guestTotal)}원 상당 · 첫 방문 고객 한정</div></div>
<div class="perf"></div><div class="body"><div class="stub">${stubs}</div>
<div class="kv" style="margin-top:12px"><span>초대인</span><b>${esc(d.n)}</b></div><div class="kv"><span>번호</span><b>${esc(d.no)}-G</b></div></div></div>
<button class="savebtn" data-cap="cap-guest" data-fn="게스트초대권">게스트 초대권 이미지 저장</button>
<div class="coupon" id="cap-amb" style="margin-top:20px"><div class="cap"><div class="tag">153 Ambassador</div><div class="ttl" style="margin-top:8px">파운딩 멤버 · 게스트 등록 시 동시 연장</div></div>
<div class="perf"></div><div class="body">${amb}<div class="note">등록 취소/환불 시 혜택 조정 · 현금 교환 및 양도 불가</div></div></div>
<button class="savebtn" data-cap="cap-amb" data-fn="앰배서더">앰배서더 이미지 저장</button></section>
<section><div class="sec-h"><div class="eyebrow">Founding Membership</div><div class="kr">게스트에게 보내는 증서</div></div>
<div class="fnd" id="cap-founding"><div class="emblem sm"><b class="gold">153</b></div>
<div class="tag">Founding Membership</div>
<div class="ttl gold">FOUNDING MEMBERSHIP</div>
<div class="krt">파운딩 멤버십 증서</div>
<div class="desc">153 파운딩 멤버가 직접 초대한 분께만<br>드리는 증서입니다</div>
<div class="host gold">${esc(d.n)}</div>
<div class="divider"><i></i><span class="diamond"></span><i></i></div>
${amb}
<div class="steps">
<div class="st"><b>1</b>이 증서를 받은 분은 153 ${esc(d.br)}에 오셔서 데스크에 보여주세요.</div>
<div class="st"><b>2</b>등록하시면 초대인과 게스트 <b style="position:static;color:#dcb84e">두 분 모두</b> 이용 기간이 늘어납니다.</div>
<div class="st"><b>3</b>첫 방문 고객에 한해 사용할 수 있으며, 등록 취소 시 혜택은 조정됩니다.</div>
</div>
<div class="foot"><div>Invited by<b>${esc(d.n)}</b></div><div class="c">Valid<b>${esc(d.v)}</b></div><div class="r">No.<b>${esc(d.no)}-F</b></div></div></div>
<button class="sharebtn" data-cap="cap-founding" data-fn="파운딩멤버십증서">게스트에게 이 증서 보내기</button>
<div class="note">버튼을 누르면 카카오톡·문자로 바로 보낼 수 있어요. 초대하고 싶은 분에게 전달해 주세요.</div>
<a class="cta" style="display:block;text-align:center;margin-top:18px" href="tel:${esc(d.tel)}">게스트 방문 예약 ${esc(d.tel)}</a></section>
<section><div class="sec-h"><div class="eyebrow">Summary</div><div class="kr">혜택 안내 · 이용 조건</div></div>${ben}
<ul class="cond">${cond}<li>발급일: ${esc(d.d)}</li></ul></section>
<section class="closing"><div class="divider"><i></i><span class="diamond"></span><i></i></div>
<div class="msg">${esc(d.closing)}</div><div class="sub">${esc(d.n)} 님의 다음 라운드를 153이 끝까지 응원합니다.</div>
<a class="cta" href="tel:${esc(d.tel)}">예약·문의 ${esc(d.tel)}</a>
<div class="foot-brand">${esc(d.gymEn)} · ${esc(d.brEn)} · ${esc(d.no)}</div></section>
</div>`;
}

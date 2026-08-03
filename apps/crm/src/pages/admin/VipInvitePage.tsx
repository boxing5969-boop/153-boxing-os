import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Gift, Copy, ExternalLink, Search, Sparkles } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { listMembers } from "@/services/members";
import {
  DEFAULTS, autoLetter, buildMin, inviteLink, kakaoMessage, todayDot, plusYear, type VipData,
} from "@/lib/vipInvite";

const ALLOWED_ROLES = new Set(["super_admin", "hq_admin", "branch_owner", "branch_manager"]);

type EventCfg = {
  br: string; brEn: string; ev: string; title: string; roman: string;
  disc: string; guestN: string; guestEach: string; guestTotal: string;
  tel: string; sign: string; closing: string; noPrefix: string;
};

function loadEvent(): EventCfg {
  try {
    const saved = JSON.parse(localStorage.getItem("vip_event") || "{}");
    return { ...defaultEvent(), ...saved };
  } catch {
    return defaultEvent();
  }
}
function defaultEvent(): EventCfg {
  return {
    br: DEFAULTS.br, brEn: DEFAULTS.brEn, ev: DEFAULTS.ev, title: DEFAULTS.title, roman: DEFAULTS.roman,
    disc: String(DEFAULTS.disc), guestN: String(DEFAULTS.guestN), guestEach: DEFAULTS.guestEach, guestTotal: DEFAULTS.guestTotal,
    tel: DEFAULTS.tel, sign: DEFAULTS.sign, closing: DEFAULTS.closing, noPrefix: DEFAULTS.noPrefix,
  };
}
function pad2(n: number): string { return n < 10 ? "0" + n : String(n); }
function loadSeq(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem("vip_seq") || "{}"); } catch { return {}; }
}
function nextNoFor(prefix: string): string {
  const m = loadSeq();
  let c = m[prefix];
  if (c == null) c = prefix === "FF7-" ? 7 : 0;
  return prefix + pad2(c + 1);
}
function bumpSeq(no: string, prefix: string) {
  const t = String(no); let i = t.length;
  while (i > 0 && t.charAt(i - 1) >= "0" && t.charAt(i - 1) <= "9") i--;
  const d = t.slice(i);
  if (!d) return;
  const m = loadSeq(); const n = parseInt(d, 10);
  if (!isNaN(n)) { m[prefix] = Math.max(m[prefix] || 0, n); localStorage.setItem("vip_seq", JSON.stringify(m)); }
}
type Hist = { n: string; r: string; link: string; msg: string; t: number };
function loadHist(): Hist[] { try { return JSON.parse(localStorage.getItem("vip_hist") || "[]"); } catch { return []; } }
function saveHist(h: Hist[]) { localStorage.setItem("vip_hist", JSON.stringify(h.slice(0, 50))); }
function maskPhone(p?: string | null): string {
  if (!p) return "";
  return p.replace(/(\d{2,3})-?(\d{3,4})-?(\d{4})/, (_m, a, _b, c) => `${a}-****-${c}`);
}

const INPUT = "w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40";
const LABEL = "block text-xs opacity-60 mb-1";

export default function VipInvitePage() {
  const { profile } = useAuth();
  const [ev, setEv] = useState<EventCfg>(loadEvent);
  const [name, setName] = useState("");
  const [rKo, setRKo] = useState("우승");
  const [rCustom, setRCustom] = useState("");
  const [rEn, setREn] = useState("CHAMPION");
  const [no, setNo] = useState(() => nextNoFor(loadEvent().noPrefix));
  const [issued, setIssued] = useState(todayDot());
  const [valid, setValid] = useState("");
  const [letter, setLetter] = useState("");
  const letterEdited = useRef(false);
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ link: string; msg: string; n: string } | null>(null);
  const [hist, setHist] = useState<Hist[]>(loadHist);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(id);
  }, [toast]);

  const search = useQuery({
    queryKey: ["vip-member-search", q],
    queryFn: () => listMembers({ q, limit: 8 }),
    enabled: q.trim().length >= 1,
    staleTime: 10_000,
  });

  if (profile && !ALLOWED_ROLES.has(profile.role)) return <Navigate to="/" replace />;

  function curResultKo() { return rKo === "직접입력" ? rCustom.trim() || "수상" : rKo; }

  function fillLetterAuto() {
    setLetter(autoLetter(name || "회원", curResultKo(), ev.ev, ev.br).join("\n\n"));
    letterEdited.current = false;
  }
  function onNameChange(v: string) {
    setName(v);
    if (!letterEdited.current) setLetter(autoLetter(v || "회원", curResultKo(), ev.ev, ev.br).join("\n\n"));
  }
  function onResultChange(v: string) {
    setRKo(v);
    if (v === "우승") setREn("CHAMPION");
    else if (v === "준우승") setREn("RUNNER-UP");
    const rk = v === "직접입력" ? rCustom.trim() || "수상" : v;
    if (!letterEdited.current) setLetter(autoLetter(name || "회원", rk, ev.ev, ev.br).join("\n\n"));
  }

  function copy(txt: string) {
    navigator.clipboard.writeText(txt).then(() => setToast("복사됐어요"), () => setToast("복사 실패 — 길게 눌러 복사"));
  }

  function generate() {
    if (!name.trim()) { setToast("회원 이름을 입력하세요"); return; }
    const rk = curResultKo();
    const L = (letter.trim() ? letter : autoLetter(name, rk, ev.ev, ev.br).join("\n\n"))
      .split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const full: VipData = {
      n: name.trim(), r: rk, re: rEn || "CHAMPION", no: no || "—", d: issued, v: valid || plusYear(issued) || "",
      ev: ev.ev, br: ev.br, brEn: ev.brEn, gymEn: DEFAULTS.gymEn, coh: DEFAULTS.coh, title: ev.title, roman: ev.roman,
      disc: ev.disc, guestN: ev.guestN, guestEach: ev.guestEach, guestTotal: ev.guestTotal,
      amb: DEFAULTS.amb, benefits: DEFAULTS.benefits, conds: DEFAULTS.conds,
      tel: ev.tel, sign: ev.sign, closing: ev.closing, L,
    };
    const link = inviteLink(buildMin(full));
    const msg = kakaoMessage(full, link);
    localStorage.setItem("vip_event", JSON.stringify(ev));
    bumpSeq(full.no, ev.noPrefix);
    const nh: Hist[] = [{ n: full.n, r: rk, link, msg, t: Date.now() }, ...hist].slice(0, 50);
    setHist(nh); saveHist(nh);
    setResult({ link, msg, n: full.n });
    // 다음 회원 준비
    setName(""); setLetter(""); letterEdited.current = false;
    setNo(nextNoFor(ev.noPrefix));
    setToast(`${full.n} 님 초대장 생성됨`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="VIP 초대장"
        description="회원에게 보낼 감사 초대장(편지·명예 증서·혜택권)을 만들어 카톡으로 발송하세요. 링크 하나에 모두 담겨 있고, 회원은 각 항목을 이미지로 저장할 수 있습니다."
      />

      {toast && <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">{toast}</p>}

      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold">회원 정보</h2>

        <div>
          <label className={LABEL}>회원 검색 (선택)</label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 size-4 opacity-40" />
            <input className={INPUT + " pl-8"} placeholder="이름·전화로 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {q.trim() && (
            <div className="mt-1 rounded-md border border-foreground/10 divide-y divide-foreground/5 max-h-56 overflow-auto">
              {search.isLoading && <div className="px-3 py-2 text-sm opacity-60">검색 중…</div>}
              {search.data && search.data.rows.length === 0 && <div className="px-3 py-2 text-sm opacity-60">결과 없음</div>}
              {search.data?.rows.map((mem) => (
                <button
                  key={mem.id}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-foreground/5"
                  onClick={() => { onNameChange(mem.name); setQ(""); }}
                >
                  <span className="font-medium">{mem.name}</span>
                  <span className="opacity-50 text-xs">{maskPhone(mem.phone)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className={LABEL}>회원 이름</label>
          <input className={INPUT} placeholder="예: 강건형" value={name} onChange={(e) => onNameChange(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>수상 (한글)</label>
            <select className={INPUT} value={rKo} onChange={(e) => onResultChange(e.target.value)}>
              <option>우승</option>
              <option>준우승</option>
              <option value="직접입력">직접 입력…</option>
            </select>
          </div>
          <div>
            <label className={LABEL}>수상 (영문 뱃지)</label>
            <input className={INPUT} value={rEn} onChange={(e) => setREn(e.target.value)} />
          </div>
        </div>
        {rKo === "직접입력" && (
          <div>
            <label className={LABEL}>수상 직접 입력 (한글)</label>
            <input className={INPUT} placeholder="예: 감투상" value={rCustom} onChange={(e) => { setRCustom(e.target.value); if (!letterEdited.current) setLetter(autoLetter(name || "회원", e.target.value || "수상", ev.ev, ev.br).join("\n\n")); }} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>증서번호 (자동)</label>
            <input className={INPUT} value={no} onChange={(e) => setNo(e.target.value)} />
          </div>
          <div>
            <label className={LABEL}>발급일</label>
            <input className={INPUT} value={issued} onChange={(e) => setIssued(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={LABEL}>사용기간 (비우면 발급일+1년 자동)</label>
          <input className={INPUT} placeholder="자동" value={valid} onChange={(e) => setValid(e.target.value)} />
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">감사 편지</h2>
          <Button size="sm" variant="outline" onClick={fillLetterAuto}>
            <Sparkles className="size-4" /> 자동 채우기
          </Button>
        </div>
        <textarea
          className={INPUT + " min-h-[150px] leading-relaxed"}
          placeholder="이름·수상 입력 시 자동으로 채워집니다. 문단은 빈 줄로 구분, 자유롭게 수정 가능."
          value={letter}
          onChange={(e) => { setLetter(e.target.value); letterEdited.current = true; }}
        />
        <p className="text-xs opacity-50">이름을 입력하면 문구가 자동 생성됩니다. 직접 고치면 자동 갱신을 멈춥니다.</p>
      </Card>

      <details className="rounded-lg border border-foreground/10 bg-foreground/[0.02]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">대회·지점·혜택 편집 (선택)</summary>
        <div className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={LABEL}>지점(한글)</label><input className={INPUT} value={ev.br} onChange={(e) => setEv({ ...ev, br: e.target.value })} /></div>
            <div><label className={LABEL}>지점(영문)</label><input className={INPUT} value={ev.brEn} onChange={(e) => setEv({ ...ev, brEn: e.target.value })} /></div>
          </div>
          <div><label className={LABEL}>대회/이벤트명</label><input className={INPUT} value={ev.ev} onChange={(e) => setEv({ ...ev, ev: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={LABEL}>패키지 제목</label><input className={INPUT} value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} /></div>
            <div><label className={LABEL}>로마숫자(회차)</label><input className={INPUT} value={ev.roman} onChange={(e) => setEv({ ...ev, roman: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={LABEL}>증서번호 접두어</label><input className={INPUT} value={ev.noPrefix} onChange={(e) => { setEv({ ...ev, noPrefix: e.target.value }); setNo(nextNoFor(e.target.value)); }} /></div>
            <div><label className={LABEL}>할인율(%)</label><input className={INPUT} value={ev.disc} onChange={(e) => setEv({ ...ev, disc: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={LABEL}>게스트 매수</label><input className={INPUT} value={ev.guestN} onChange={(e) => setEv({ ...ev, guestN: e.target.value })} /></div>
            <div><label className={LABEL}>1매 금액</label><input className={INPUT} value={ev.guestEach} onChange={(e) => setEv({ ...ev, guestEach: e.target.value })} /></div>
            <div><label className={LABEL}>총액</label><input className={INPUT} value={ev.guestTotal} onChange={(e) => setEv({ ...ev, guestTotal: e.target.value })} /></div>
          </div>
          <div><label className={LABEL}>예약 전화번호</label><input className={INPUT} value={ev.tel} onChange={(e) => setEv({ ...ev, tel: e.target.value })} /></div>
          <div><label className={LABEL}>서명</label><input className={INPUT} value={ev.sign} onChange={(e) => setEv({ ...ev, sign: e.target.value })} /></div>
          <div><label className={LABEL}>맺음말</label><input className={INPUT} value={ev.closing} onChange={(e) => setEv({ ...ev, closing: e.target.value })} /></div>
          <p className="text-xs opacity-50">이 설정은 이 브라우저에 저장되어 다음 발급에도 유지됩니다.</p>
        </div>
      </details>

      <Button className="w-full" onClick={generate}>
        <Gift className="size-4" /> 링크 만들기
      </Button>

      {result && (
        <Card className="p-5 space-y-3 border-amber-300">
          <p className="text-sm font-semibold text-amber-700">✅ {result.n} 님 초대장이 만들어졌어요</p>
          <div>
            <label className={LABEL}>회원 링크</label>
            <div className="rounded-md bg-foreground/5 px-3 py-2 text-xs break-all">{result.link}</div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => copy(result.link)}><Copy className="size-3" /> 링크 복사</Button>
              <a href={result.link} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline"><ExternalLink className="size-3" /> 미리보기</Button>
              </a>
            </div>
          </div>
          <div>
            <label className={LABEL}>카톡 문구</label>
            <div className="rounded-md bg-foreground/5 px-3 py-2 text-xs whitespace-pre-wrap">{result.msg}</div>
            <div className="mt-2">
              <Button size="sm" onClick={() => copy(result.msg)}><Copy className="size-3" /> 카톡 문구 복사</Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">발급 목록 (이 브라우저)</h2>
          {hist.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => copy(hist.map((h) => h.msg).join("\n\n──────────\n\n"))}>
              전체 문구 복사
            </Button>
          )}
        </div>
        {hist.length === 0 ? (
          <p className="text-sm opacity-50">아직 발급한 초대장이 없습니다.</p>
        ) : (
          <div className="divide-y divide-foreground/5">
            {hist.map((h, i) => (
              <div key={i} className="flex items-center gap-2 py-2 text-sm">
                <span className="font-medium min-w-16">{h.n}</span>
                <span className="text-amber-600 text-xs min-w-12">{h.r}</span>
                <div className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => copy(h.link)}>링크</Button>
                  <Button size="sm" variant="outline" onClick={() => copy(h.msg)}>문구</Button>
                  <a href={h.link} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline">열기</Button></a>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

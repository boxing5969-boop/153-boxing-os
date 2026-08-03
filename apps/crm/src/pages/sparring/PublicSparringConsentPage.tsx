/**
 * 스파링 참여 동의서 (공개) — /s/:slug
 *
 * 체육관 QR로 열어 회원이 직접 읽고 서명한다. 로그인 없음.
 * - 생년월일로 만 나이를 계산해 미성년자면 보호자 칸이 자동으로 열린다.
 * - 항목별 체크 + 손글씨 서명이 모두 있어야 제출된다.
 *
 * ⚠️ 문안(CLAUSES)을 고치면 워커의 DOC_VERSION 도 함께 올린다.
 *    "그때 그 사람이 어떤 문안에 동의했는지"를 나중에 특정할 수 있어야 한다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

const API = (import.meta.env.VITE_API_BASE_URL as string) ?? "";

interface Clause { key: string; title: string; body: string }
const CLAUSES: Clause[] = [
  {
    key: "risk",
    title: "부상 위험을 이해했습니다",
    body:
      "스파링은 실제 타격이 오가는 훈련입니다. 타박상·찰과상·코피·염좌·골절·치아 손상이 생길 수 있고, " +
      "머리 충격으로 뇌진탕이 발생할 수 있습니다. 보호장비를 착용해도 위험이 완전히 사라지지 않는다는 점을 이해합니다.",
  },
  {
    key: "health",
    title: "건강 상태를 사실대로 알렸습니다",
    body:
      "심장·혈압 질환, 뇌·신경 질환, 간질, 최근 수술·골절, 임신, 눈 질환(망막 등), 혈액응고 장애가 있는 경우 " +
      "스파링에 참여할 수 없습니다. 해당 사항이 없으며, 있다면 아래에 적어 알렸음을 확인합니다. " +
      "훈련 중 몸에 이상이 느껴지면 즉시 중단하고 코치에게 알리겠습니다.",
  },
  {
    key: "rules",
    title: "안전 수칙을 지키겠습니다",
    body:
      "헤드기어·마우스피스·글러브 등 지정 보호장비를 반드시 착용하고, 코치가 정한 강도와 상대만 지킵니다. " +
      "코치의 '스톱' 지시에 즉시 멈추며, 감정적으로 강도를 올리지 않습니다. " +
      "코치 승인 없는 스파링은 하지 않겠습니다.",
  },
  {
    key: "emergency",
    title: "응급조치에 동의합니다",
    body:
      "훈련 중 사고가 발생하면 체육관이 119 신고·응급처치·병원 이송 등 필요한 조치를 하는 데 동의합니다. " +
      "미성년자의 경우 보호자에게 즉시 연락합니다.",
  },
  {
    key: "privacy",
    title: "개인정보 수집에 동의합니다",
    body:
      "수집 항목: 성명·연락처·생년월일·서명(미성년자는 보호자 성명·연락처 포함). " +
      "목적: 스파링 참여 자격 확인 및 안전사고 대응. 보유 기간: 동의일로부터 3년(관련 분쟁 발생 시 종결까지). " +
      "동의를 거부할 수 있으나, 이 경우 스파링에 참여할 수 없습니다.",
  },
];

const AGREE_ALL_LABEL = "위 5개 항목을 모두 읽고 동의합니다";

function digits(s: string): string { return s.replace(/\D/g, ""); }
function ageOf(birth: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
  const b = new Date(`${birth}T00:00:00`);
  if (isNaN(b.getTime())) return null;
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  const m = n.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--;
  return a;
}

/** 손글씨 서명 패드 — 마우스·터치 공용 */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    // 화면 밀도에 맞춰 실제 픽셀을 키운다(모바일에서 서명이 뭉개지지 않게).
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * ratio; cv.height = h * ratio;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111827";
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = ref.current?.getContext("2d"); if (!ctx) return;
    const p = pos(e);
    drawing.current = true; dirty.current = true;
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = ref.current?.getContext("2d"); if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const cv = ref.current;
    if (cv && dirty.current) onChange(cv.toDataURL("image/png"));
  };
  const clear = () => {
    const cv = ref.current; const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    dirty.current = false; onChange(null);
  };

  return (
    <div>
      <canvas
        ref={ref}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        className="h-40 w-full touch-none rounded-xl border border-dashed border-gray-300 bg-white"
      />
      <div className="mt-1.5 flex items-center justify-between">
        <p className="text-[11px] text-gray-400">위 칸에 손가락으로 서명해 주세요</p>
        <button type="button" onClick={clear} className="text-[12px] text-gray-500 underline">지우기</button>
      </div>
    </div>
  );
}

export default function PublicSparringConsentPage() {
  const { slug = "" } = useParams();
  const [head, setHead] = useState<{ branch_name: string; title: string | null } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birth, setBirth] = useState("");
  const [gName, setGName] = useState("");
  const [gPhone, setGPhone] = useState("");
  const [gRel, setGRel] = useState("");
  const [health, setHealth] = useState("");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const age = ageOf(birth);
  const isMinor = age != null && age < 19;
  const allChecked = CLAUSES.every((cl) => checks[cl.key]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${API}/api/sparring/ch/${encodeURIComponent(slug)}`);
        const j = await res.json();
        if (!alive) return;
        if (!res.ok || !j?.data) { setLoadErr(j?.message ?? "없는 주소입니다"); return; }
        setHead(j.data);
      } catch { if (alive) setLoadErr("연결에 실패했습니다"); }
    })();
    return () => { alive = false; };
  }, [slug]);

  const toggleAll = useCallback(() => {
    const next = !allChecked;
    const m: Record<string, boolean> = {};
    for (const cl of CLAUSES) m[cl.key] = next;
    setChecks(m);
  }, [allChecked]);

  async function submit() {
    setErr(null);
    if (name.trim().length < 2) return setErr("성함을 입력해주세요");
    if (digits(phone).length < 9) return setErr("연락처를 확인해주세요");
    if (age == null) return setErr("생년월일을 확인해주세요");
    if (!allChecked) return setErr("모든 항목에 동의해야 접수됩니다");
    if (isMinor && (gName.trim().length < 2 || digits(gPhone).length < 9)) {
      return setErr("미성년자는 보호자 성함과 연락처가 필요합니다");
    }
    if (!sig) return setErr("서명을 입력해주세요");

    setBusy(true);
    try {
      const res = await fetch(`${API}/api/sparring/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug, member_name: name.trim(), phone: digits(phone), birth_date: birth,
          guardian_name: isMinor ? gName.trim() : null,
          guardian_phone: isMinor ? digits(gPhone) : null,
          guardian_relation: isMinor ? (gRel.trim() || null) : null,
          agree_risk: true, agree_health: true, agree_rules: true, agree_emergency: true, agree_privacy: true,
          health_notes: health.trim() || null,
          signature: sig,
        }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j?.message ?? "제출에 실패했습니다"); return; }
      setDone(true);
    } catch {
      setErr("연결에 실패했습니다. 잠시 후 다시 시도해주세요");
    } finally {
      setBusy(false);
    }
  }

  if (loadErr) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6 text-center">
        <div>
          <p className="text-[15px] font-bold text-gray-800">스파링 동의서</p>
          <p className="mt-1 text-[13px] text-gray-500">{loadErr}</p>
        </div>
      </div>
    );
  }
  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl">✓</div>
          <p className="text-[17px] font-bold text-gray-900">동의서가 접수되었습니다</p>
          <p className="mt-2 text-[13px] leading-relaxed text-gray-500">
            {name} 님, 감사합니다.<br />
            안전하게 훈련하실 수 있도록 코치가 함께하겠습니다.
          </p>
          <p className="mt-4 text-[11.5px] text-gray-400">이 화면은 닫으셔도 됩니다.</p>
        </div>
      </div>
    );
  }

  const INPUT = "w-full rounded-xl border border-gray-300 px-3 py-2.5 text-[15px] focus:border-gray-900 focus:outline-none";

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <header className="bg-gray-900 px-5 py-5 text-white">
        <p className="text-[11px] tracking-widest text-white/60">SPARRING CONSENT</p>
        <h1 className="mt-1 text-[19px] font-bold">스파링 참여 동의서</h1>
        <p className="mt-0.5 text-[13px] text-white/70">{head?.branch_name ?? "153복싱짐"}</p>
      </header>

      <div className="mx-auto max-w-lg space-y-4 p-4">
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-[12.5px] leading-relaxed text-amber-900">
          스파링은 실제 타격이 오가는 훈련입니다. 아래 내용을 <b>직접 읽고</b> 동의해 주세요.
          동의하지 않으셔도 다른 훈련은 그대로 이용하실 수 있습니다.
        </p>

        {/* 참여자 */}
        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
          <p className="text-[14px] font-bold text-gray-900">참여자 정보</p>
          <div>
            <label className="mb-1 block text-[12px] text-gray-500">성함</label>
            <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
          </div>
          <div>
            <label className="mb-1 block text-[12px] text-gray-500">연락처</label>
            <input className={INPUT} type="tel" inputMode="numeric" value={phone}
              onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" />
          </div>
          <div>
            <label className="mb-1 block text-[12px] text-gray-500">생년월일</label>
            <input className={INPUT} type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
            {age != null && (
              <p className={`mt-1 text-[12px] ${isMinor ? "text-amber-700" : "text-gray-400"}`}>
                만 {age}세{isMinor ? " · 미성년자라 보호자 동의가 필요합니다" : " · 본인이 직접 동의하실 수 있습니다"}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-[12px] text-gray-500">알릴 병력·부상 <span className="text-gray-300">(없으면 비워두세요)</span></label>
            <textarea className={`${INPUT} h-20 resize-none`} value={health} onChange={(e) => setHealth(e.target.value)}
              placeholder="예) 3개월 전 오른쪽 어깨 탈구" />
          </div>
        </section>

        {/* 보호자 — 미성년자일 때만 */}
        {isMinor && (
          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-2 ring-amber-300">
            <div>
              <p className="text-[14px] font-bold text-gray-900">보호자 동의</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-gray-500">
                만 19세 미만은 본인 동의만으로는 효력이 약합니다. 보호자께서 내용을 확인하시고 아래를 채운 뒤 서명해 주세요.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[12px] text-gray-500">보호자 성함</label>
              <input className={INPUT} value={gName} onChange={(e) => setGName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[12px] text-gray-500">보호자 연락처</label>
              <input className={INPUT} type="tel" inputMode="numeric" value={gPhone} onChange={(e) => setGPhone(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[12px] text-gray-500">관계</label>
              <input className={INPUT} value={gRel} onChange={(e) => setGRel(e.target.value)} placeholder="예) 부 / 모" />
            </div>
          </section>
        )}

        {/* 동의 항목 */}
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
          <p className="mb-2 text-[14px] font-bold text-gray-900">동의 항목</p>
          <div className="space-y-2">
            {CLAUSES.map((cl, i) => {
              const on = !!checks[cl.key];
              return (
                <button key={cl.key} type="button" onClick={() => setChecks((m) => ({ ...m, [cl.key]: !on }))}
                  className={`flex w-full gap-3 rounded-xl border p-3 text-left ${on ? "border-gray-900 bg-gray-50" : "border-gray-200 bg-white"}`}>
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[12px] ${on ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-transparent"}`}>✓</span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-bold text-gray-900">{i + 1}. {cl.title}</span>
                    <span className="mt-1 block text-[12px] leading-relaxed text-gray-500">{cl.body}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={toggleAll}
            className={`mt-3 w-full rounded-xl py-3 text-[14px] font-bold ${allChecked ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>
            {allChecked ? "전체 동의함" : AGREE_ALL_LABEL}
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
            이 동의서는 체육관의 고의 또는 중대한 과실로 인한 책임까지 면제하지 않습니다.
            시설 관리 소홀이나 코치의 명백한 잘못으로 사고가 나면 체육관이 책임집니다.
          </p>
        </section>

        {/* 서명 */}
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
          <p className="mb-2 text-[14px] font-bold text-gray-900">
            {isMinor ? "보호자 서명" : "본인 서명"}
          </p>
          <SignaturePad onChange={setSig} />
        </section>

        {err && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-700">{err}</p>}

        <button type="button" onClick={() => void submit()} disabled={busy}
          className="w-full rounded-xl bg-gray-900 py-4 text-[15px] font-bold text-white disabled:opacity-50">
          {busy ? "제출 중…" : "동의하고 제출"}
        </button>
        <p className="pb-6 text-center text-[11px] text-gray-400">제출하시면 동의 일시가 함께 기록됩니다.</p>
      </div>
    </div>
  );
}

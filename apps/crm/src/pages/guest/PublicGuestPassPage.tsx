/**
 * 게스트 초대권 (공개) — /g/:slug
 *
 * 회원이 온보딩 문자로 받은 링크. 열면 3만원 상당 무료 체험권 1장이 들어 있다.
 * 회원은 이 링크를 지인에게 그대로 전달하고, 지인은 데스크에서 화면을 보여주면 된다.
 *
 * ⚠️ 사용 처리는 데스크(직원 앱)에서만 한다. 여기서는 상태를 보여주기만 한다.
 *    회원 화면에 '사용하기' 버튼을 두면 지인 없이도 소진되고 되돌릴 수 없다.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const API = (import.meta.env.VITE_API_BASE_URL as string) ?? "";

interface Pass {
  slug: string;
  issuer_name: string | null;
  value_won: number;
  valid_until: string | null;
  status: string;
  used_at: string | null;
  branch_name: string;
  branch_phone: string | null;
}

function won(n: number): string { return n.toLocaleString("ko-KR"); }
function dot(d: string | null): string { return d ? d.replace(/-/g, ".") : ""; }

export default function PublicGuestPassPage() {
  const { slug = "" } = useParams();
  const [pass, setPass] = useState<Pass | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${API}/api/guest-pass/p/${encodeURIComponent(slug)}`);
        const j = await res.json();
        if (!alive) return;
        if (!res.ok || !j?.data?.pass) { setErr(j?.message ?? "없는 초대권입니다"); return; }
        setPass(j.data.pass as Pass);
      } catch { if (alive) setErr("연결에 실패했습니다"); }
    })();
    return () => { alive = false; };
  }, [slug]);

  useEffect(() => {
    document.title = pass ? `게스트 초대권 · ${pass.branch_name}` : "게스트 초대권";
  }, [pass]);

  if (err) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b1020] p-6 text-center">
        <div>
          <p className="text-[15px] font-bold text-white">게스트 초대권</p>
          <p className="mt-1 text-[13px] text-white/50">{err}</p>
        </div>
      </div>
    );
  }
  if (!pass) {
    return <div className="flex min-h-screen items-center justify-center bg-[#0b1020] text-[13px] text-white/40">불러오는 중…</div>;
  }

  const expired = !!pass.valid_until && pass.valid_until < new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const dead = pass.status !== "issued" || expired;

  const share = async () => {
    const url = window.location.href;
    const text = `${pass.branch_name} 게스트 초대권이에요. ${won(pass.value_won)}원 상당 무료 체험 1회권입니다.\n${url}`;
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ title: "게스트 초대권", text }); return; } catch { /* 취소 */ } }
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* 무시 */ }
  };

  return (
    <div className="min-h-screen bg-[#0b1020] px-5 py-10">
      <div className="mx-auto max-w-md">
        <p className="text-center text-[11px] tracking-[0.3em] text-white/40">GUEST PASS</p>
        <h1 className="mt-1 text-center text-[20px] font-bold text-white">게스트 초대권</h1>
        <p className="mt-1 text-center text-[13px] text-white/50">{pass.branch_name}</p>

        {/* 쿠폰 */}
        <div className={`relative mt-6 overflow-hidden rounded-3xl bg-white ${dead ? "opacity-60" : ""}`}>
          <div className="px-6 pt-7 text-center">
            <p className="text-[12px] font-bold tracking-widest text-[#B45309]">FREE TRIAL</p>
            <p className="mt-2 text-[52px] font-bold leading-none text-[#0b1020]">
              {won(pass.value_won)}<span className="text-[24px]">원</span>
            </p>
            <p className="mt-1 text-[14px] font-bold text-gray-700">상당 무료 체험 1회권</p>
          </div>

          {/* 절취선 */}
          <div className="relative my-5">
            <div className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-[#0b1020]" />
            <div className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-[#0b1020]" />
            <div className="mx-6 border-t border-dashed border-gray-300" />
          </div>

          <div className="space-y-2 px-6 pb-7 text-[13px]">
            {pass.issuer_name && (
              <div className="flex justify-between"><span className="text-gray-400">초대한 분</span><b className="text-gray-800">{pass.issuer_name} 님</b></div>
            )}
            <div className="flex justify-between"><span className="text-gray-400">사용 기한</span><b className="text-gray-800">{dot(pass.valid_until) || "제한 없음"}</b></div>
            <div className="flex justify-between"><span className="text-gray-400">번호</span><b className="tracking-widest text-gray-800">{pass.slug.toUpperCase()}</b></div>
            <div className="flex justify-between">
              <span className="text-gray-400">상태</span>
              <b className={pass.status === "used" ? "text-red-500" : expired ? "text-red-500" : pass.status === "void" ? "text-gray-400" : "text-emerald-600"}>
                {pass.status === "used" ? "사용 완료" : expired ? "기한 지남" : pass.status === "void" ? "취소됨" : "사용 가능"}
              </b>
            </div>
          </div>
        </div>

        {!dead && (
          <button onClick={() => void share()}
            className="mt-4 w-full rounded-2xl bg-[#e7c884] py-4 text-[15px] font-bold text-[#3a2c05]">
            {copied ? "복사했습니다" : "친구에게 보내기"}
          </button>
        )}

        <div className="mt-5 rounded-2xl bg-white/5 px-5 py-4 text-[12.5px] leading-relaxed text-white/70">
          <p className="mb-2 font-bold text-white/90">사용 방법</p>
          <p>1. 같이 운동하고 싶은 분께 이 링크를 보내주세요.</p>
          <p>2. 그분이 {pass.branch_name}에 방문해 이 화면을 보여주시면 됩니다.</p>
          <p>3. 데스크에서 확인 후 바로 체험 수업을 진행합니다.</p>
          <p className="mt-2 text-white/40">첫 방문 고객에 한해 1회 사용할 수 있습니다.</p>
        </div>

        {pass.branch_phone && (
          <a href={`tel:${pass.branch_phone}`}
            className="mt-3 block rounded-2xl border border-white/15 py-3.5 text-center text-[14px] text-white/80">
            방문 문의 {pass.branch_phone}
          </a>
        )}

        <p className="mt-6 text-center text-[11px] text-white/25">153 BOXING</p>
      </div>
    </div>
  );
}

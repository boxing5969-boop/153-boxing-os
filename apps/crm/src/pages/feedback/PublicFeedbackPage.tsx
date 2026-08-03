/**
 * 공개 회원 의견 페이지 — /f/:slug  (체육관 키오스크 QR)
 *
 * - ProtectedRoute 밖: 로그인 없이 접근 가능
 * - 워커 공개 API(/api/feedback/ch, /submit) 사용. 익명이 기본.
 * - 연락처는 '매달 추첨 참여'를 켠 경우에만 입력받고, 동의 체크가 필수.
 * - UX 목표: 스캔 → 30초 안에 제출. 분류만 고르면 바로 쓸 수 있게.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CheckCircle2, Star, Gift, Send, Lightbulb, ThumbsUp,
  MessageSquareHeart, MessageCircle, Loader2, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/cn";

const API = (import.meta.env.VITE_API_BASE_URL as string) ?? "";

// 공개 페이지 — 독립 레이아웃이라 style 주입 OK
const ANIM_CSS = `
@keyframes fbIn { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform:none; } }
.fb-in { animation: fbIn .34s cubic-bezier(.22,.61,.36,1) both; }
@keyframes fbPop { 0%{transform:scale(.8)} 60%{transform:scale(1.14)} 100%{transform:scale(1)} }
.fb-pop { animation: fbPop .26s ease-out; }
@keyframes fbGlow { 0%,100%{opacity:.55} 50%{opacity:1} }
.fb-glow { animation: fbGlow 2.4s ease-in-out infinite; }
`;

type Category = "improvement" | "coach_praise" | "complaint" | "free";

const CATEGORIES: { key: Category; label: string; hint: string; Icon: typeof Lightbulb; ring: string; bg: string }[] = [
  { key: "improvement", label: "개선 제안", hint: "이건 이렇게 바뀌면 좋겠어요", Icon: Lightbulb, ring: "ring-amber-400", bg: "bg-amber-50 text-amber-700" },
  { key: "coach_praise", label: "코치 칭찬", hint: "고마운 코치님이 있어요", Icon: ThumbsUp, ring: "ring-emerald-400", bg: "bg-emerald-50 text-emerald-700" },
  { key: "complaint", label: "불편·건의", hint: "불편했던 점을 알려주세요", Icon: MessageSquareHeart, ring: "ring-rose-400", bg: "bg-rose-50 text-rose-700" },
  { key: "free", label: "자유 한마디", hint: "무엇이든 좋아요", Icon: MessageCircle, ring: "ring-sky-400", bg: "bg-sky-50 text-sky-700" },
];

interface ChannelInfo {
  branch_name: string;
  title: string | null;
  prize_text: string | null;
}

// ── 별점 ────────────────────────────────────────────────────────
function RatingPicker({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="flex justify-center gap-2">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value != null && n <= value;
        return (
          <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n}점`}
            className={cn("transition-transform active:scale-90", value === n && "fb-pop")}>
            <Star className={cn("size-9 transition-colors", on ? "fill-amber-400 text-amber-400" : "text-gray-200")} />
          </button>
        );
      })}
    </div>
  );
}

// ── 완료 화면 ───────────────────────────────────────────────────
function DoneScreen({ drawEntered, note, prize }: { drawEntered: boolean; note: string | null; prize: string | null }) {
  return (
    <div className="fb-in mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="grid size-20 place-items-center rounded-full bg-emerald-50">
        <CheckCircle2 className="size-11 text-emerald-500" />
      </div>
      <h1 className="mt-5 text-2xl font-extrabold text-gray-900">소중한 의견 감사합니다!</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-gray-500">
        보내주신 의견은 지점장님과 본사가 직접 확인하고<br />체육관 개선에 반영합니다.
      </p>
      {drawEntered && (
        <div className="mt-6 w-full rounded-2xl bg-gradient-to-br from-[#14213D] to-[#2F58D0] p-5 text-white shadow-lg">
          <Gift className="mx-auto size-7" />
          <p className="mt-2 text-[15px] font-bold">이번 달 추첨 응모 완료 🎉</p>
          {prize && <p className="mt-1 text-[12.5px] text-white/80">{prize}</p>}
          <p className="mt-2 text-[11.5px] text-white/60">당첨되시면 남겨주신 연락처로 안내드려요.</p>
        </div>
      )}
      {note && <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-700">{note}</p>}
      <p className="mt-8 text-[11.5px] text-gray-400">153복싱짐은 회원님의 한마디로 성장합니다.</p>
    </div>
  );
}

export default function PublicFeedbackPage() {
  const { slug = "" } = useParams();
  const [ch, setCh] = useState<ChannelInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [category, setCategory] = useState<Category | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [coachName, setCoachName] = useState("");
  const [drawOptIn, setDrawOptIn] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ drawEntered: boolean; note: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${API}/api/feedback/ch/${encodeURIComponent(slug)}`);
        const json = (await res.json()) as { success: boolean; data: ChannelInfo; error?: { message?: string } };
        if (!alive) return;
        if (!res.ok || !json.success) throw new Error(json.error?.message ?? "페이지를 찾을 수 없어요");
        setCh(json.data);
      } catch (e) {
        if (alive) setLoadErr(e instanceof Error ? e.message : "페이지를 불러오지 못했어요");
      }
    })();
    return () => { alive = false; };
  }, [slug]);

  const canSubmit = !!category && content.trim().length >= 2 && !busy &&
    (!drawOptIn || (agreed && contactPhone.replace(/\D/g, "").length >= 10));

  async function submit() {
    if (!canSubmit || !category) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${API}/api/feedback/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug, category, rating,
          content: content.trim(),
          coach_name: category === "coach_praise" ? coachName.trim() || null : null,
          draw_opt_in: drawOptIn,
          contact_name: drawOptIn ? contactName.trim() || null : null,
          contact_phone: drawOptIn ? contactPhone.trim() || null : null,
          privacy_agreed: drawOptIn ? agreed : false,
        }),
      });
      const json = (await res.json()) as { success: boolean; data: { drawEntered: boolean; note: string | null }; error?: { message?: string } };
      if (!res.ok || !json.success) throw new Error(json.error?.message ?? "전송에 실패했어요");
      setDone({ drawEntered: json.data.drawEntered, note: json.data.note });
      window.scrollTo({ top: 0 });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "전송에 실패했어요");
    } finally {
      setBusy(false);
    }
  }

  if (loadErr) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-8 text-center">
        <AlertTriangle className="size-10 text-amber-400" />
        <p className="mt-3 text-[15px] font-bold text-gray-800">{loadErr}</p>
        <p className="mt-1 text-[12.5px] text-gray-400">체육관에 비치된 QR을 다시 스캔해 주세요.</p>
      </div>
    );
  }
  if (done) return (<><style>{ANIM_CSS}</style><DoneScreen drawEntered={done.drawEntered} note={done.note} prize={ch?.prize_text ?? null} /></>);
  if (!ch) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-gray-300" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gray-50 pb-32">
      <style>{ANIM_CSS}</style>

      {/* 히어로 */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#14213D] via-[#1E3A6E] to-[#2F58D0] px-6 pb-9 pt-[calc(env(safe-area-inset-top)+30px)] text-white">
        <div className="fb-glow pointer-events-none absolute -right-10 -top-6 size-40 rounded-full bg-[#28C7A5]/25 blur-3xl" />
        <p className="relative text-[12px] font-semibold tracking-wide text-[#7EC8FF]">{ch.branch_name}</p>
        <h1 className="relative mt-1.5 text-[26px] font-extrabold leading-tight">
          회원님의 한마디가<br />체육관을 바꿉니다
        </h1>
        <p className="relative mt-2 text-[13px] leading-relaxed text-white/70">
          좋았던 점, 아쉬웠던 점, 고마운 코치님까지<br />편하게 남겨주세요. <b className="text-white">익명으로 전달</b>됩니다.
        </p>
        {ch.prize_text && (
          <div className="relative mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-2 ring-1 ring-inset ring-white/20">
            <Gift className="size-4 text-[#F7B84B]" />
            <span className="text-[12.5px] font-bold">{ch.prize_text}</span>
          </div>
        )}
      </div>

      <div className="mx-auto -mt-4 max-w-md space-y-4 px-4">
        {/* 1. 분류 */}
        <section className="fb-in rounded-3xl bg-white p-4 shadow-sm">
          <p className="text-[13px] font-bold text-gray-900">어떤 이야기인가요?</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {CATEGORIES.map(({ key, label, hint, Icon, ring, bg }) => {
              const on = category === key;
              return (
                <button key={key} type="button" onClick={() => setCategory(key)}
                  className={cn(
                    "rounded-2xl p-3 text-left transition-all active:scale-[0.98]",
                    on ? `${bg} ring-2 ${ring}` : "bg-gray-50 text-gray-600 ring-1 ring-gray-100",
                  )}>
                  <Icon className={cn("size-5", on ? "" : "text-gray-400")} />
                  <p className="mt-1.5 text-[13px] font-bold">{label}</p>
                  <p className="mt-0.5 text-[10.5px] leading-tight opacity-70">{hint}</p>
                </button>
              );
            })}
          </div>
        </section>

        {category && (
          <>
            {/* 2. 코치 이름 (칭찬일 때만) */}
            {category === "coach_praise" && (
              <section className="fb-in rounded-3xl bg-white p-4 shadow-sm">
                <p className="text-[13px] font-bold text-gray-900">어느 코치님인가요? <span className="font-normal text-gray-400">(선택)</span></p>
                <input value={coachName} onChange={(e) => setCoachName(e.target.value)} maxLength={40}
                  placeholder="예: 오삼이 코치님"
                  className="mt-2.5 w-full rounded-xl border border-gray-200 px-3.5 py-3 text-[14px] outline-none focus:border-[#3C6FF7]" />
              </section>
            )}

            {/* 3. 별점 */}
            <section className="fb-in rounded-3xl bg-white p-4 shadow-sm">
              <p className="text-center text-[13px] font-bold text-gray-900">요즘 153은 어떠세요? <span className="font-normal text-gray-400">(선택)</span></p>
              <div className="mt-3"><RatingPicker value={rating} onChange={setRating} /></div>
            </section>

            {/* 4. 내용 */}
            <section className="fb-in rounded-3xl bg-white p-4 shadow-sm">
              <p className="text-[13px] font-bold text-gray-900">자유롭게 적어주세요</p>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} maxLength={2000}
                placeholder={
                  category === "coach_praise" ? "어떤 점이 좋았는지 한 줄이면 충분해요 :)"
                    : category === "complaint" ? "언제, 어떤 점이 불편하셨나요?"
                    : category === "improvement" ? "이렇게 바뀌면 더 좋겠다 싶은 점을 알려주세요"
                    : "편하게 한마디 남겨주세요"
                }
                className="mt-2.5 w-full resize-none rounded-xl border border-gray-200 p-3.5 text-[14px] leading-relaxed outline-none focus:border-[#3C6FF7]" />
              <p className="mt-1 text-right text-[11px] text-gray-300">{content.length}/2000</p>
            </section>

            {/* 5. 추첨 참여 */}
            <section className="fb-in overflow-hidden rounded-3xl bg-white shadow-sm">
              <button type="button" onClick={() => setDrawOptIn((v) => !v)}
                className="flex w-full items-center gap-3 p-4 text-left active:bg-gray-50">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#F7B84B]/15">
                  <Gift className="size-5 text-[#D9962B]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold text-gray-900">매달 추첨 이벤트 참여하기</span>
                  <span className="mt-0.5 block text-[11.5px] text-gray-500">{ch.prize_text ?? "매달 추첨 선물"} · 참여는 선택이에요</span>
                </span>
                <span className={cn("h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors", drawOptIn ? "bg-[#28C7A5]" : "bg-gray-200")}>
                  <span className={cn("block size-5 rounded-full bg-white shadow transition-transform", drawOptIn && "translate-x-5")} />
                </span>
              </button>

              {drawOptIn && (
                <div className="fb-in space-y-2.5 border-t border-gray-100 p-4">
                  <input value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={40}
                    placeholder="이름"
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-[14px] outline-none focus:border-[#3C6FF7]" />
                  <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} maxLength={20}
                    type="tel" inputMode="numeric" placeholder="연락처 (당첨 안내용)"
                    className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-[14px] outline-none focus:border-[#3C6FF7]" />
                  <label className="flex items-start gap-2.5 rounded-xl bg-gray-50 p-3">
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-4 accent-[#3C6FF7]" />
                    <span className="text-[11.5px] leading-relaxed text-gray-600">
                      <b>개인정보 수집·이용 동의</b> (필수)<br />
                      추첨·당첨 안내 목적으로 이름·연락처를 수집하며, <b>추첨 종료 후 파기</b>합니다.
                      의견 내용은 연락처와 분리되어 <b>익명</b>으로 전달됩니다.
                    </span>
                  </label>
                </div>
              )}
            </section>
          </>
        )}

        {err && <p className="rounded-xl bg-rose-50 px-4 py-3 text-center text-[12.5px] text-rose-600">{err}</p>}
      </div>

      {/* 제출 */}
      {category && (
        <div className="fixed inset-x-0 bottom-0 border-t border-gray-100 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-3 backdrop-blur">
          <div className="mx-auto max-w-md">
            <button onClick={() => void submit()} disabled={!canSubmit}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#3C6FF7] to-[#28C7A5] py-4 text-[15px] font-extrabold text-white shadow-lg shadow-[#3C6FF7]/25 transition active:scale-[0.99] disabled:opacity-40 disabled:shadow-none">
              {busy ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-4" />}
              {busy ? "보내는 중…" : "의견 보내기"}
            </button>
            <p className="mt-2 text-center text-[11px] text-gray-400">
              {drawOptIn ? "추첨 참여 + 익명 의견으로 전달됩니다" : "익명으로 전달됩니다 · 이름·연락처 없이 보내집니다"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

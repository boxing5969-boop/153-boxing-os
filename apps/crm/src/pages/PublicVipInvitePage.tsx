import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { decodeData, invitationHTML, INV_CSS, type VipData } from "@/lib/vipInvite";

// 공개 VIP 초대장 — 로그인 불필요. 링크의 #d= 를 해석해 렌더한다.
// 회원이 각 항목을 이미지로 폰에 저장하고, 파운딩 증서는 게스트에게 바로 전달할 수 있다.

type ShareNav = Navigator & {
  canShare?: (d: { files?: File[] }) => boolean;
  share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>;
};

// 폰의 기본 공유창으로 증서 이미지를 그대로 보낸다(카카오톡·문자·메일).
// 미지원 브라우저·사용자 취소 시 false → 저장 화면으로 대체한다.
async function shareImage(blob: Blob, name: string, host: string): Promise<boolean> {
  try {
    const nav = navigator as ShareNav;
    if (!nav.share || !nav.canShare) return false;
    const file = new File([blob], name, { type: "image/png" });
    if (!nav.canShare({ files: [file] })) return false;
    await nav.share({
      files: [file],
      title: "153 파운딩 멤버십 증서",
      text: `${host} 님이 보내는 153 파운딩 멤버십 증서입니다. 등록하실 때 데스크에 보여주세요.`,
    });
    return true;
  } catch {
    return false;
  }
}
export default function PublicVipInvitePage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [lightbox, setLightbox] = useState<{ url: string; name: string; blob?: Blob | null } | null>(null);

  const data: VipData | null = useMemo(() => {
    const m = window.location.hash.match(/[#&]d=([^&]+)/);
    const code = m?.[1];
    return code ? decodeData(code) : null;
  }, []);

  useEffect(() => {
    document.title = data ? `${data.n} 님께 · 153` : "153 초대장";
    const id = "vip-fonts";
    if (!document.getElementById(id)) {
      const l = document.createElement("link");
      l.id = id;
      l.rel = "stylesheet";
      l.href =
        "https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Noto+Sans+KR:wght@300;400;500;700&family=Noto+Serif+KR:wght@400;500;600;700&display=swap";
      document.head.appendChild(l);
    }
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const root = rootRef.current;
    if (!root) return;
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(".savebtn,.sharebtn"));
    const handlers: Array<() => void> = [];
    for (const btn of buttons) {
      const onClick = async () => {
        const capId = btn.getAttribute("data-cap") || "";
        const fn = btn.getAttribute("data-fn") || "invitation";
        const wantShare = btn.classList.contains("sharebtn");
        const el = document.getElementById(capId);
        if (!el) return;
        root.classList.add("capturing");
        try {
          if (document.fonts && document.fonts.ready) await document.fonts.ready;
          const canvas = await html2canvas(el, {
            scale: 2,
            backgroundColor: "#0b0b10",
            useCORS: true,
            logging: false,
          });
          const name = `153_${data.n}_${fn}.png`;
          const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
          // 게스트에게 바로 전달 — 폰의 기본 공유창(카카오톡·문자·메일)을 연다.
          if (wantShare && blob && (await shareImage(blob, name, data.n))) return;
          setLightbox({ url: canvas.toDataURL("image/png"), name, blob });
        } catch {
          /* noop */
        } finally {
          root.classList.remove("capturing");
        }
      };
      btn.addEventListener("click", onClick);
      handlers.push(() => btn.removeEventListener("click", onClick));
    }
    return () => handlers.forEach((h) => h());
  }, [data]);

  if (!data) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0e", color: "#cdc4a9", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Noto Sans KR',sans-serif", padding: 24, textAlign: "center" }}>
        <div>
          <div style={{ color: "#dcb84e", fontSize: 20, marginBottom: 8 }}>153 BOXING</div>
          <div style={{ fontSize: 14, opacity: 0.8 }}>유효하지 않은 초대장 링크입니다.</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{INV_CSS}</style>
      <div className="vip-root" ref={rootRef} dangerouslySetInnerHTML={{ __html: invitationHTML(data) }} />
      {lightbox && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightbox(null);
          }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.92)", zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div style={{ color: "#f7e9b6", fontSize: 14, marginBottom: 8, textAlign: "center", fontFamily: "'Noto Sans KR',sans-serif" }}>
            {lightbox.name.replace(/^153_/, "").replace(/\.png$/, "").replace(/_/g, " ")}
          </div>
          <img src={lightbox.url} alt="" style={{ maxWidth: "100%", maxHeight: "74vh", border: "1px solid #3a3320", borderRadius: 8 }} />
          <div style={{ color: "#9b8f73", fontSize: 12, textAlign: "center", margin: "12px 0", fontFamily: "'Noto Sans KR',sans-serif" }}>
            아이폰: 이미지를 꾹 눌러 '사진에 저장' · 안드로이드: 아래 저장 버튼
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            {lightbox.blob && (navigator as ShareNav).share && (
              <button
                onClick={() => {
                  if (lightbox.blob) void shareImage(lightbox.blob, lightbox.name, data.n);
                }}
                style={{ border: 0, background: "linear-gradient(180deg,#f0dc9a,#dcb84e 55%,#b8912f)", color: "#20180a", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Noto Sans KR',sans-serif" }}
              >
                보내기 ↗
              </button>
            )}
            <a href={lightbox.url} download={lightbox.name} style={{ border: "1px solid #dcb84e", background: "rgba(220,184,78,.08)", color: "#f7e9b6", borderRadius: 8, padding: "10px 18px", fontSize: 13, textDecoration: "none", fontFamily: "'Noto Sans KR',sans-serif" }}>
              이미지 저장 ⬇
            </a>
            <button onClick={() => setLightbox(null)} style={{ border: "1px solid #dcb84e", background: "rgba(220,184,78,.08)", color: "#f7e9b6", borderRadius: 8, padding: "10px 18px", fontSize: 13, cursor: "pointer", fontFamily: "'Noto Sans KR',sans-serif" }}>
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  );
}

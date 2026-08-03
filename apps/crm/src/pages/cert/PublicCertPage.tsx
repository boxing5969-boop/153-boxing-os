/**
 * 공개 결제확인서 — /p/:slug (회원이 문자 링크로 열람)
 *
 * - ProtectedRoute 밖: 로그인 없이 접근 가능.
 * - 워커 공개 API(/api/cert/pub/:slug)로 데이터 조회 → 캔버스로 확인서를 그려 "이미지"로 표시.
 * - [이미지 저장] = 캔버스 PNG 다운로드 (회사 제출용).
 */
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Download, Loader2, AlertTriangle } from "lucide-react";

const API = (import.meta.env.VITE_API_BASE_URL as string) ?? "";

interface CertData {
  cert_no: string;
  member_name: string;
  product_name: string;
  amount: number;
  payment_method: string | null;
  paid_date: string | null;
  period_start: string | null;
  period_end: string | null;
  purpose: string | null;
  issued_at: string;
  branch_name: string;
  branch_phone: string | null;
  branch_biz_no: string | null;
}

const won = (n: number) => n.toLocaleString("ko-KR");
const dstr = (s: string | null | undefined) => (s ? s.replace(/-/g, ".") : "-");

/**
 * 사각 인장 「一五三印」 — 한자만·각인 붓글씨풍(굵은 다중획) + 잉크 빠짐 질감 + 기울임.
 * 실제 법인 사각 인감 구성(굵은 사각 테두리 + 2×2 한자, 칸에 꽉 차게).
 * size = 도장 한 변 픽셀.
 */
function drawSeal(main: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const RED = "#C42626";
  const S = size;
  const off = document.createElement("canvas");
  off.width = S; off.height = S;
  const x = off.getContext("2d");
  if (!x) return;
  const k = S / 560; // 기준 560 대비 스케일

  // 굵은 사각 테두리
  const BW = Math.max(4, 26 * k);
  x.strokeStyle = RED;
  x.lineWidth = BW;
  x.strokeRect(BW / 2, BW / 2, S - BW, S - BW);

  // 2×2 「一五三印」 — 칸에 꽉 차게 + 다중 오프셋으로 붓획 두껍게(각인 느낌)
  const chars = ["一", "五", "三", "印"];
  const pad = BW + 22 * k;
  const gap = 18 * k;
  const cell = (S - pad * 2 - gap) / 2;
  x.fillStyle = RED;
  x.textAlign = "center"; x.textBaseline = "middle";
  const offs = [-3 * k, -1 * k, 0, 1 * k, 3 * k];
  chars.forEach((ch, i) => {
    const r = Math.floor(i / 2), col = i % 2;
    const ccx = pad + col * (cell + gap) + cell / 2;
    const ccy = pad + r * (cell + gap) + cell / 2;
    x.save();
    x.translate(ccx, ccy);
    // 글자를 칸에 꽉 채우기: '一' 같은 납작 글자는 세로로 늘림
    const sy = ch === "一" ? 1.5 : 1.12;
    x.scale(1.14, sy);
    x.font = `bold ${cell * 0.82}px 'Batang', 'BatangChe', serif`;
    for (const dx of offs) for (const dy of offs) x.fillText(ch, dx, dy);
    x.restore();
  });

  // 잉크 빠짐 질감
  x.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 320; i++) {
    const px = Math.random() * S, py = Math.random() * S;
    const sz = (0.6 + Math.random() * 2) * Math.max(1, k * 3);
    x.globalAlpha = 0.3 + Math.random() * 0.5;
    x.beginPath(); x.arc(px, py, sz, 0, Math.PI * 2); x.fill();
  }
  x.globalAlpha = 1;
  x.globalCompositeOperation = "source-over";

  // 본 캔버스에 살짝 기울여 합성 (찍힌 느낌)
  main.save();
  main.translate(cx, cy);
  main.rotate((-4 * Math.PI) / 180);
  main.globalAlpha = 0.93;
  main.drawImage(off, -S / 2, -S / 2);
  main.restore();
}

/** 캔버스에 확인서 렌더 (900×1200, A4 비율 근사) */
function drawCert(canvas: HTMLCanvasElement, c: CertData) {
  const W = 900, H = 1200;
  canvas.width = W; canvas.height = H;
  const x = canvas.getContext("2d");
  if (!x) return;
  const NAVY = "#14213D", BLUE = "#3C6FF7", MINT = "#28C7A5", GRAY = "#64748B", LINE = "#E5E7EB";

  // 바탕 + 테두리
  x.fillStyle = "#FFFFFF"; x.fillRect(0, 0, W, H);
  x.strokeStyle = NAVY; x.lineWidth = 6; x.strokeRect(16, 16, W - 32, H - 32);
  x.strokeStyle = MINT; x.lineWidth = 2; x.strokeRect(30, 30, W - 60, H - 60);

  // 헤더
  x.fillStyle = NAVY; x.fillRect(30, 30, W - 60, 150);
  x.fillStyle = "#FFFFFF"; x.textAlign = "center";
  x.font = "bold 54px 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
  x.fillText("결 제 확 인 서", W / 2, 118);
  x.font = "500 22px 'Malgun Gothic', sans-serif"; x.fillStyle = "#9DB8FF";
  x.fillText("PAYMENT CONFIRMATION", W / 2, 155);

  // 발급번호 · 발급일
  x.textAlign = "left"; x.fillStyle = GRAY; x.font = "500 22px 'Malgun Gothic', sans-serif";
  x.fillText(`발급번호  ${c.cert_no}`, 70, 236);
  x.textAlign = "right";
  x.fillText(`발급일  ${dstr(c.issued_at.slice(0, 10))}`, W - 70, 236);

  // 본문 문구
  x.textAlign = "center"; x.fillStyle = "#111827";
  x.font = "500 30px 'Malgun Gothic', sans-serif";
  x.fillText(`아래와 같이 결제되었음을 확인합니다.`, W / 2, 310);

  // 표
  const rows: [string, string][] = [
    ["성명", c.member_name],
    ["결제 상품", c.product_name],
    ["결제 금액", `${won(c.amount)}원`],
    ["결제 수단", c.payment_method ?? "-"],
    ["결제일", dstr(c.paid_date)],
    ["이용 기간", c.period_start || c.period_end ? `${dstr(c.period_start)} ~ ${dstr(c.period_end)}` : "-"],
    ...(c.purpose ? [["용도", c.purpose] as [string, string]] : []),
  ];
  const T = 360, RH = 76, LX = 70, LW = 230, RX = W - 70;
  const VX = LX + LW + 34;               // 값 시작 x
  const VMAX = RX - VX - 22;             // 값 최대 폭 (표 밖으로 못 나가게)
  rows.forEach(([k, v], i) => {
    const y = T + i * RH;
    x.fillStyle = i % 2 === 0 ? "#F8FAFC" : "#FFFFFF";
    x.fillRect(LX, y, RX - LX, RH);
    x.strokeStyle = LINE; x.lineWidth = 1; x.strokeRect(LX, y, RX - LX, RH);
    x.fillStyle = "#F1F5F9"; x.fillRect(LX, y, LW, RH);
    x.strokeStyle = LINE; x.strokeRect(LX, y, LW, RH);
    x.textAlign = "center"; x.fillStyle = GRAY; x.font = "bold 26px 'Malgun Gothic', sans-serif";
    x.fillText(k, LX + LW / 2, y + RH / 2 + 9);
    x.textAlign = "left"; x.fillStyle = k === "결제 금액" ? BLUE : "#111827";
    x.font = `${k === "결제 금액" ? "bold 32px" : "500 28px"} 'Malgun Gothic', sans-serif`;
    if (x.measureText(v).width <= VMAX) {
      x.fillText(v, VX, y + RH / 2 + 10);
    } else {
      // 긴 값(상품명 등) → 글자 줄이고 최대 2줄로 줄바꿈, 넘치면 말줄임
      x.font = "500 23px 'Malgun Gothic', sans-serif";
      const lines: string[] = [];
      let cur = "";
      for (const ch of v) {
        if (x.measureText(cur + ch).width > VMAX && cur) {
          lines.push(cur); cur = ch;
          if (lines.length === 2) break;
        } else cur += ch;
      }
      if (lines.length < 2 && cur) lines.push(cur);
      const l1 = lines[0] ?? "";
      let l2 = lines[1];
      if (l2 !== undefined && cur && l2 !== cur) {
        // 2줄로도 못 담음 → 말줄임
        while (l2.length > 0 && x.measureText(l2 + "…").width > VMAX) l2 = l2.slice(0, -1);
        l2 = l2 + "…";
      }
      if (l2 === undefined) x.fillText(l1, VX, y + RH / 2 + 8);
      else { x.fillText(l1, VX, y + RH / 2 - 8); x.fillText(l2, VX, y + RH / 2 + 22); }
    }
  });

  const bottom = T + rows.length * RH;

  // 발급 기관
  x.textAlign = "center"; x.fillStyle = "#111827";
  x.font = "bold 40px 'Malgun Gothic', sans-serif";
  x.fillText(c.branch_name, W / 2, bottom + 120);
  // 사업자등록번호 · 문의 — 회사 제출 증빙 관행 항목
  x.fillStyle = GRAY; x.font = "500 24px 'Malgun Gothic', sans-serif";
  const sub: string[] = [];
  if (c.branch_biz_no) sub.push(`사업자등록번호 ${c.branch_biz_no}`);
  if (c.branch_phone) sub.push(`문의 ${c.branch_phone}`);
  if (sub.length > 0) x.fillText(sub.join("   ·   "), W / 2, bottom + 160);

  // 직인 — 사각 인장 「一五三印」 (한자만·각인풍, 기관명 옆에 겹쳐 찍기)
  drawSeal(x, W / 2 + 205, bottom + 102, 148);

  // 푸터
  x.fillStyle = "#94A3B8"; x.font = "400 19px 'Malgun Gothic', sans-serif";
  x.fillText("본 확인서는 153복싱짐 결제 내역 확인 용도로 발급되었습니다.", W / 2, H - 84);
  x.fillStyle = MINT; x.fillRect(30, H - 40, W - 60, 10);
}

export default function PublicCertPage() {
  const { slug = "" } = useParams();
  const [cert, setCert] = useState<CertData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${API}/api/cert/pub/${encodeURIComponent(slug)}`);
        const json = (await res.json()) as { success: boolean; data: CertData; error?: { message?: string } };
        if (!alive) return;
        if (!res.ok || !json.success) throw new Error(json.error?.message ?? "확인서를 찾을 수 없어요");
        setCert(json.data);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "불러오지 못했어요");
      }
    })();
    return () => { alive = false; };
  }, [slug]);

  // 데이터 도착 → 캔버스 렌더 → PNG 데이터 URL
  useEffect(() => {
    if (!cert) return;
    const cv = canvasRef.current ?? document.createElement("canvas");
    canvasRef.current = cv;
    drawCert(cv, cert);
    setImg(cv.toDataURL("image/png"));
  }, [cert]);

  if (err) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-8 text-center">
        <AlertTriangle className="size-10 text-amber-400" />
        <p className="mt-3 text-[15px] font-bold text-gray-800">{err}</p>
        <p className="mt-1 text-[12.5px] text-gray-400">지점에 다시 요청해 주세요.</p>
      </div>
    );
  }
  if (!cert || !img) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-gray-300" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gray-100 pb-28">
      <div className="bg-[#14213D] px-5 pb-5 pt-[calc(env(safe-area-inset-top)+18px)] text-center text-white">
        <p className="text-[12px] font-semibold text-[#7EC8FF]">{cert.branch_name}</p>
        <h1 className="mt-0.5 text-[19px] font-extrabold">결제확인서</h1>
        <p className="mt-0.5 text-[11.5px] text-white/60">아래 이미지를 길게 눌러 저장하거나, 저장 버튼을 누르세요</p>
      </div>

      <div className="mx-auto max-w-md px-4 py-5">
        {/* 확인서 = 이미지 (길게 눌러 저장 가능) */}
        <img src={img} alt={`결제확인서 ${cert.cert_no}`} className="w-full rounded-xl shadow-lg ring-1 ring-gray-200" />
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-3 backdrop-blur">
        <div className="mx-auto max-w-md">
          <a
            href={img}
            download={`결제확인서_${cert.member_name}_${cert.cert_no}.png`}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#3C6FF7] to-[#28C7A5] py-4 text-[15px] font-extrabold text-white shadow-lg active:scale-[0.99]"
          >
            <Download className="size-5" /> 이미지로 저장
          </a>
          <p className="mt-2 text-center text-[11px] text-gray-400">저장이 안 되면 이미지를 길게 눌러 '이미지 저장'을 선택하세요.</p>
        </div>
      </div>
    </div>
  );
}

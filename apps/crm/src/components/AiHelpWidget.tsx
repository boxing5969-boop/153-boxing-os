/**
 * AI 도우미 플로팅 위젯
 * - 오른쪽 하단 버튼 클릭 시 슬라이드업 패널로 ai.html 임베드
 * - 외부 클릭 / ESC 로 닫기
 */
import { useState, useEffect, useRef } from "react";
import { X, BotMessageSquare } from "lucide-react";
import { cn } from "@/lib/cn";

export default function AiHelpWidget() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // ESC 닫기
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    // 검수 반영: 타이머를 clear 하지 않으면 100ms 안에 닫힘/언마운트 시
    // 제거 불가능한 스테일 리스너가 영구 잔존한다.
    const t = setTimeout(() => document.addEventListener("mousedown", onClick), 100);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <>
      {/* 패널 */}
      <div
        ref={panelRef}
        className={cn(
          // 모바일: 하단 탭바(≈54px) + 버튼 위로. 데스크톱: 기존 위치.
          "fixed bottom-36 md:bottom-20 right-5 z-50 w-[380px] max-w-[calc(100vw-24px)]",
          // 작은 화면에서 상단(닫기 버튼) 잘림 방지
          "h-[560px] max-h-[calc(100dvh-10rem)]",
          "rounded-2xl overflow-hidden shadow-2xl border border-border",
          "transition-all duration-300 origin-bottom-right",
          open
            ? "opacity-100 scale-100 pointer-events-auto"
            : "opacity-0 scale-95 pointer-events-none"
        )}
      >
        {/* 헤더 닫기 버튼 */}
        <div className="absolute top-3 right-3 z-10">
          <button
            onClick={() => setOpen(false)}
            className="flex size-7 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
          >
            <X className="size-3.5" />
          </button>
        </div>
        {/* iframe — ai.html은 같은 origin의 /ai.html */}
        {open && (
          <iframe
            src="/ai.html"
            className="w-full h-full border-0"
            title="153OS AI 도우미"
          />
        )}
      </div>

      {/* 플로팅 버튼 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          // 검수 반영: 모바일에선 하단 탭바(z-40, ≈54px)의 '더보기' 탭을 덮지 않게 위로 띄운다
          "fixed bottom-20 md:bottom-5 right-5 z-50",
          "flex items-center gap-2 rounded-full shadow-xl transition-all duration-200",
          open
            ? "bg-muted text-muted-foreground px-4 py-2.5 text-sm font-medium"
            : "bg-brand text-white px-4 py-2.5 text-sm font-bold hover:bg-brand/90 hover:scale-105"
        )}
      >
        <BotMessageSquare className="size-4 shrink-0" />
        {open ? "닫기" : "AI 도우미"}
      </button>
    </>
  );
}

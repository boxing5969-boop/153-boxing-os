/**
 * PWA 설치 버튼 + iOS 안내 모달
 *
 * - 안드로이드(크롬·삼성인터넷): `beforeinstallprompt` 이벤트 감지 → 네이티브 설치 다이얼로그
 * - iOS(사파리): 자동 설치 프롬프트 미지원 → 수동 추가 안내 모달 표시
 * - 이미 설치된 경우(standalone): 버튼 자체를 숨김
 *
 * 두 가지 표시 모드:
 *   <PwaInstallPrompt variant="button" />  로그인 페이지 하단용 — 텍스트 버튼
 *   <PwaInstallPrompt variant="icon"   />  대시보드 헤더용 — 작은 아이콘 버튼
 */
import { useEffect, useState } from "react";
import { Smartphone, Share, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";

// `beforeinstallprompt` 이벤트의 비공식 타입 — 표준 DOM 타입 정의에 없음
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // 표준 PWA 감지 + iOS Safari 호환
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari 전용 — navigator.standalone
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

interface Props {
  variant?: "button" | "icon";
  className?: string;
}

export function PwaInstallPrompt({ variant = "button", className }: Props) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosModal, setShowIosModal] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  // 이미 설치됨 → 버튼 숨김
  if (installed) return null;

  const handleClick = async () => {
    // 안드로이드/Chrome — 네이티브 다이얼로그
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") setInstalled(true);
        setDeferredPrompt(null);
      } catch {
        // prompt 가 이미 사용된 경우 등 — 무시
      }
      return;
    }
    // iOS — 수동 안내 모달
    if (isIos()) {
      setShowIosModal(true);
      return;
    }
    // 그 외 (Chrome 인데 아직 설치 기준 미충족 등) — iOS 모달 형식으로 일반 안내
    setShowIosModal(true);
  };

  return (
    <>
      {variant === "button" ? (
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            "inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl",
            "border border-border bg-card text-foreground text-sm font-medium",
            "hover:bg-muted transition-colors",
            className,
          )}
          aria-label="153OS 앱으로 설치"
        >
          <Smartphone className="size-4" aria-hidden />
          앱으로 설치
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          className={cn(
            "inline-flex items-center justify-center size-9 rounded-lg",
            "border border-border bg-card text-foreground",
            "hover:bg-muted transition-colors",
            className,
          )}
          aria-label="153OS 앱으로 설치"
          title="앱으로 설치"
        >
          <Smartphone className="size-4" aria-hidden />
        </button>
      )}

      {showIosModal && (
        <IosInstallModal onClose={() => setShowIosModal(false)} ios={isIos()} />
      )}
    </>
  );
}

interface ModalProps {
  onClose: () => void;
  ios: boolean;
}

function IosInstallModal({ onClose, ios }: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4 animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-install-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-card shadow-xl border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 id="pwa-install-title" className="text-base font-bold text-foreground">
            📱 153OS 앱으로 설치
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-lg hover:bg-muted flex items-center justify-center"
            aria-label="닫기"
          >
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-5 py-4 space-y-4">
          {ios ? (
            <>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Safari에서 153OS를 홈 화면에 추가하면 일반 앱처럼 풀스크린으로 사용할 수 있습니다.
              </p>
              <ol className="space-y-3 text-sm text-foreground">
                <li className="flex gap-3">
                  <span className="shrink-0 size-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                    1
                  </span>
                  <span>
                    Safari 하단의 <Share className="inline size-4 align-text-bottom" /> <b>공유</b> 버튼을 누르세요.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="shrink-0 size-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                    2
                  </span>
                  <span>
                    메뉴를 아래로 내려 <Plus className="inline size-4 align-text-bottom" /> <b>"홈 화면에 추가"</b>를 선택하세요.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="shrink-0 size-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                    3
                  </span>
                  <span>오른쪽 위 <b>"추가"</b>를 누르면 홈 화면에 153OS 아이콘이 생깁니다.</span>
                </li>
              </ol>
              <p className="text-xs text-muted-foreground">
                ⚠️ Chrome·다른 브라우저가 아닌 <b>Safari</b>에서 열어야 설치 가능합니다.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground leading-relaxed">
                현재 브라우저에서는 자동 설치 다이얼로그가 나타나지 않았습니다. 아래 방법으로 직접 설치할 수 있습니다.
              </p>
              <ol className="space-y-3 text-sm text-foreground">
                <li className="flex gap-3">
                  <span className="shrink-0 size-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                    1
                  </span>
                  <span>주소창 옆의 <b>설치 아이콘</b>(또는 메뉴 ⋮)을 누르세요.</span>
                </li>
                <li className="flex gap-3">
                  <span className="shrink-0 size-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                    2
                  </span>
                  <span><b>"앱 설치"</b> 또는 <b>"홈 화면에 추가"</b>를 선택하세요.</span>
                </li>
              </ol>
              <p className="text-xs text-muted-foreground">
                💡 안드로이드 Chrome / Edge / 삼성인터넷에서 가장 잘 작동합니다.
              </p>
            </>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 border-t border-border bg-muted/30 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

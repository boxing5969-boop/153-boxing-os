import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import MobileNav from "./MobileNav";
import Header from "./Header";
import GlobalSearch from "@/components/GlobalSearch";
import AiHelpWidget from "@/components/AiHelpWidget";

export default function AppLayout() {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* 데스크톱/태블릿 사이드바 (모바일에서는 숨김) */}
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        {/* 모바일은 하단 탭바에 가리지 않도록 pb 확보 */}
        <main className="flex-1 overflow-auto p-4 pb-24 md:p-6 md:pb-6">
          <div className="mx-auto max-w-7xl animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
      {/* 모바일 하단 탭바 (md 미만 전용) */}
      <MobileNav />
      {/* 글로벌 검색 오버레이 (Cmd+K) */}
      <GlobalSearch />
      {/* AI 도우미 플로팅 위젯 */}
      <AiHelpWidget />
    </div>
  );
}

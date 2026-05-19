import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import GlobalSearch from "@/components/GlobalSearch";
import AiHelpWidget from "@/components/AiHelpWidget";

export default function AppLayout() {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-7xl animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
      {/* 글로벌 검색 오버레이 (Cmd+K) */}
      <GlobalSearch />
      {/* AI 도우미 플로팅 위젯 */}
      <AiHelpWidget />
    </div>
  );
}

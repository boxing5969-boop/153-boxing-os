import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold">404</h1>
        <p className="text-sm opacity-70">페이지를 찾을 수 없습니다.</p>
        <Link to="/">
          <Button>대시보드로 이동</Button>
        </Link>
      </div>
    </main>
  );
}

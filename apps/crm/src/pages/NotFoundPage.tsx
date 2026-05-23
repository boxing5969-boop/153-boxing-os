import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="space-y-4 text-center">
        <h1 className="text-4xl font-black tracking-tight text-foreground">404</h1>
        <p className="text-sm text-muted-foreground">페이지를 찾을 수 없습니다.</p>
        <Link to="/">
          <Button className="h-11 gap-2 rounded-full px-6">대시보드로 이동</Button>
        </Link>
      </div>
    </main>
  );
}

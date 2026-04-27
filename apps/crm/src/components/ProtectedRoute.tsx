import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function ProtectedRoute() {
  const { user, profile, loading, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm opacity-70">
        로딩 중…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-bold">프로필이 연결되지 않았습니다</h1>
          <p className="text-sm opacity-70">
            본사 관리자에게 문의하세요. (Supabase Auth 의 사용자 ID 가{" "}
            <code className="rounded bg-foreground/10 px-1">profiles.auth_user_id</code>{" "}
            컬럼에 등록되어야 합니다.)
          </p>
          <p className="text-xs opacity-50">로그인 이메일: {user.email}</p>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => void signOut()}
          >
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  return <Outlet />;
}

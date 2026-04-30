import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function ProtectedRoute() {
  const { user, profile, authLoading, profileState, signOut, refreshProfile } = useAuth();
  const location = useLocation();

  if (authLoading || profileState === "idle" || profileState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm opacity-70">
        로딩 중…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (profileState === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-bold">프로필을 불러오지 못했습니다</h1>
          <p className="text-sm opacity-70">
            네트워크 또는 일시적 오류일 수 있습니다. 다시 시도하거나 새로고침 해주세요.
          </p>
          <p className="text-xs opacity-50">로그인 이메일: {user.email}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-foreground/5"
              onClick={() => void refreshProfile()}
            >
              다시 시도
            </button>
            <button
              type="button"
              className="text-sm underline"
              onClick={() => void signOut()}
            >
              로그아웃
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (profileState === "missing" || !profile) {
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

import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/layout/AppLayout";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import MembersListPage from "@/pages/members/MembersListPage";
import MemberNewPage from "@/pages/members/MemberNewPage";
import MemberDetailPage from "@/pages/members/MemberDetailPage";
import MembershipsListPage from "@/pages/memberships/MembershipsListPage";
import AccessLogsPage from "@/pages/access-logs/AccessLogsPage";
import DevicesListPage from "@/pages/devices/DevicesListPage";
import NotFoundPage from "@/pages/NotFoundPage";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/members" element={<MembersListPage />} />
            <Route path="/members/new" element={<MemberNewPage />} />
            <Route path="/members/:id" element={<MemberDetailPage />} />
            <Route path="/memberships" element={<MembershipsListPage />} />
            <Route path="/access-logs" element={<AccessLogsPage />} />
            <Route path="/devices" element={<DevicesListPage />} />
            {/* PR 5.5 에서 라우트 추가 */}
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}

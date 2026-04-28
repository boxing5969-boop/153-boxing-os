import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/layout/AppLayout";

// 핵심 페이지: eager (로그인/대시보드)
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import NotFoundPage from "@/pages/NotFoundPage";

// 나머지 페이지: lazy (코드 분할 — 첫 로드 시 다운로드 안 함)
const MembersListPage = lazy(() => import("@/pages/members/MembersListPage"));
const MemberNewPage = lazy(() => import("@/pages/members/MemberNewPage"));
const MemberDetailPage = lazy(() => import("@/pages/members/MemberDetailPage"));
const MembershipsListPage = lazy(() => import("@/pages/memberships/MembershipsListPage"));
const AccessLogsPage = lazy(() => import("@/pages/access-logs/AccessLogsPage"));
const DevicesListPage = lazy(() => import("@/pages/devices/DevicesListPage"));
const DeviceDetailPage = lazy(() => import("@/pages/devices/DeviceDetailPage"));
const VisitorsListPage = lazy(() => import("@/pages/visitors/VisitorsListPage"));
const BranchesListPage = lazy(() => import("@/pages/branches/BranchesListPage"));
const BranchDetailPage = lazy(() => import("@/pages/branches/BranchDetailPage"));
const LevelsListPage = lazy(() => import("@/pages/levels/LevelsListPage"));
const MemberLevelsPage = lazy(() => import("@/pages/levels/MemberLevelsPage"));
const ProfilePage = lazy(() => import("@/pages/settings/ProfilePage"));
const StaffListPage = lazy(() => import("@/pages/staff/StaffListPage"));
const EmergencyPinsPage = lazy(() => import("@/pages/admin/EmergencyPinsPage"));
const AlertsPage = lazy(() => import("@/pages/admin/AlertsPage"));
const RevenuePage = lazy(() => import("@/pages/admin/RevenuePage"));
const HelpPage = lazy(() => import("@/pages/HelpPage"));
const KioskHomePage = lazy(() => import("@/pages/kiosk/KioskHomePage"));
const SignupPage = lazy(() => import("@/pages/SignupPage"));

function PageFallback() {
  return (
    <div className="flex items-center justify-center p-12 text-sm opacity-60">
      페이지 로딩 중…
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route element={<ProtectedRoute />}>
            {/* Kiosk: full-screen, no sidebar/header */}
            <Route path="/kiosk" element={<KioskHomePage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/members" element={<MembersListPage />} />
              <Route path="/members/new" element={<MemberNewPage />} />
              <Route path="/members/:id" element={<MemberDetailPage />} />
              <Route path="/memberships" element={<MembershipsListPage />} />
              <Route path="/access-logs" element={<AccessLogsPage />} />
              <Route path="/devices" element={<DevicesListPage />} />
              <Route path="/devices/:id" element={<DeviceDetailPage />} />
              <Route path="/visitors" element={<VisitorsListPage />} />
              <Route path="/branches" element={<BranchesListPage />} />
              <Route path="/branches/:id" element={<BranchDetailPage />} />
              <Route path="/levels" element={<LevelsListPage />} />
              <Route path="/levels/:id" element={<MemberLevelsPage />} />
              <Route path="/settings/profile" element={<ProfilePage />} />
              <Route path="/staff" element={<StaffListPage />} />
              <Route path="/admin/emergency-pins" element={<EmergencyPinsPage />} />
              <Route path="/admin/alerts" element={<AlertsPage />} />
              <Route path="/admin/revenue" element={<RevenuePage />} />
              <Route path="/help" element={<HelpPage />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}

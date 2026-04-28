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
import DeviceDetailPage from "@/pages/devices/DeviceDetailPage";
import VisitorsListPage from "@/pages/visitors/VisitorsListPage";
import BranchesListPage from "@/pages/branches/BranchesListPage";
import LevelsListPage from "@/pages/levels/LevelsListPage";
import MemberLevelsPage from "@/pages/levels/MemberLevelsPage";
import ProfilePage from "@/pages/settings/ProfilePage";
import StaffListPage from "@/pages/staff/StaffListPage";
import EmergencyPinsPage from "@/pages/admin/EmergencyPinsPage";
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
            <Route path="/devices/:id" element={<DeviceDetailPage />} />
            <Route path="/visitors" element={<VisitorsListPage />} />
            <Route path="/branches" element={<BranchesListPage />} />
            <Route path="/levels" element={<LevelsListPage />} />
            <Route path="/levels/:id" element={<MemberLevelsPage />} />
            <Route path="/settings/profile" element={<ProfilePage />} />
            <Route path="/staff" element={<StaffListPage />} />
            <Route path="/admin/emergency-pins" element={<EmergencyPinsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}

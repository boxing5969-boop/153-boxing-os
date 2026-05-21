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
const StaffRolesPage = lazy(() => import("@/pages/staff/StaffRolesPage"));
const EmergencyPinsPage = lazy(() => import("@/pages/admin/EmergencyPinsPage"));
const AlertsPage = lazy(() => import("@/pages/admin/AlertsPage"));
const RevenuePage = lazy(() => import("@/pages/admin/RevenuePage"));
const NotificationLogsPage = lazy(() => import("@/pages/admin/NotificationLogsPage"));
const BulkNotifyPage = lazy(() => import("@/pages/admin/BulkNotifyPage"));
const MessageTemplatesPage = lazy(() => import("@/pages/admin/MessageTemplatesPage"));
const ScheduledMessagesPage = lazy(() => import("@/pages/admin/ScheduledMessagesPage"));
const MessageSendLogsPage = lazy(() => import("@/pages/admin/MessageSendLogsPage"));
const FinancePage = lazy(() => import("@/pages/finance/FinancePage"));
const HelpPage = lazy(() => import("@/pages/HelpPage"));
const KioskHomePage = lazy(() => import("@/pages/kiosk/KioskHomePage"));
const SignupPage = lazy(() => import("@/pages/SignupPage"));
// 수업/PT
const ClassSchedulePage = lazy(() => import("@/pages/classes/ClassSchedulePage"));
// 본사
const HqDashboardPage = lazy(() => import("@/pages/admin/HqDashboardPage"));
// HR
const ContractViewPage = lazy(() => import("@/pages/hr/ContractViewPage"));
const HrStaffListPage = lazy(() => import("@/pages/hr/HrStaffListPage"));
const HrStaffDetailPage = lazy(() => import("@/pages/hr/HrStaffDetailPage"));
const HrContractsPage = lazy(() => import("@/pages/hr/HrContractsPage"));
const HrPayrollPage = lazy(() => import("@/pages/hr/HrPayrollPage"));
// 코치 업무보드
const CoachDashboardPage = lazy(() => import("@/pages/coach/CoachDashboardPage"));
// KPI 대시보드
const KpiDashboardPage = lazy(() => import("@/pages/kpi/KpiDashboardPage"));
// FC AI Care Center
const FcTaskInboxPage = lazy(() => import("@/pages/fc/FcTaskInboxPage"));
const RevenueBoardPage = lazy(() => import("@/pages/fc/RevenueBoardPage"));
// 회원만족 설문
const SurveysListPage = lazy(() => import("@/pages/surveys/SurveysListPage"));
const SurveyDetailPage = lazy(() => import("@/pages/surveys/SurveyDetailPage"));
const SurveySendPage = lazy(() => import("@/pages/surveys/SurveySendPage"));
const SurveyResultsPage = lazy(() => import("@/pages/surveys/SurveyResultsPage"));
// 공개 설문 응답 페이지 (로그인 불필요)
const PublicSurveyPage = lazy(() => import("@/pages/surveys/PublicSurveyPage"));

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
          {/* 공개 계약서 뷰 — 로그인 없이 접근 가능 */}
          <Route path="/contracts/view/:contractId" element={<ContractViewPage />} />
          {/* 공개 설문 응답 페이지 — 로그인 없이 접근 가능 */}
          <Route path="/s/:slug" element={<PublicSurveyPage />} />
          <Route element={<ProtectedRoute />}>
            {/* Kiosk: full-screen, no sidebar/header */}
            <Route path="/kiosk" element={<KioskHomePage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/kpi" element={<KpiDashboardPage />} />
              {/* FC AI Care Center */}
              <Route path="/fc/tasks" element={<FcTaskInboxPage />} />
              <Route path="/fc/revenue-board" element={<RevenueBoardPage />} />
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
              <Route path="/staff/roles" element={<StaffRolesPage />} />
              <Route path="/admin/emergency-pins" element={<EmergencyPinsPage />} />
              <Route path="/admin/alerts" element={<AlertsPage />} />
              <Route path="/admin/revenue" element={<RevenuePage />} />
              <Route path="/admin/notification-logs" element={<NotificationLogsPage />} />
              <Route path="/admin/bulk-notify" element={<BulkNotifyPage />} />
              <Route path="/admin/msg-templates" element={<MessageTemplatesPage />} />
              <Route path="/admin/scheduled-msgs" element={<ScheduledMessagesPage />} />
              <Route path="/admin/send-logs" element={<MessageSendLogsPage />} />
              <Route path="/finance" element={<FinancePage />} />
              <Route path="/help" element={<HelpPage />} />
              {/* 수업/PT */}
              <Route path="/classes" element={<ClassSchedulePage />} />
              {/* 본사 */}
              <Route path="/hq" element={<HqDashboardPage />} />
              {/* HR */}
              <Route path="/hr/staff" element={<HrStaffListPage />} />
              <Route path="/hr/staff/:staffId" element={<HrStaffDetailPage />} />
              <Route path="/hr/contracts" element={<HrContractsPage />} />
              <Route path="/hr/payroll" element={<HrPayrollPage />} />
              <Route path="/hr/payroll/new" element={<HrPayrollPage />} />
              {/* 코치 업무보드 */}
              <Route path="/coach" element={<CoachDashboardPage />} />
              {/* 회원만족 설문 */}
              <Route path="/surveys" element={<SurveysListPage />} />
              <Route path="/surveys/:id" element={<SurveyDetailPage />} />
              <Route path="/surveys/:id/send" element={<SurveySendPage />} />
              <Route path="/surveys/:id/results" element={<SurveyResultsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}

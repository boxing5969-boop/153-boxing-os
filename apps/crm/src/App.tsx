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
const MemberImportPage = lazy(() => import("@/pages/members/MemberImportPage"));
const MemberDetailPage = lazy(() => import("@/pages/members/MemberDetailPage"));
const MembershipsListPage = lazy(() => import("@/pages/memberships/MembershipsListPage"));
const AccessLogsPage = lazy(() => import("@/pages/access-logs/AccessLogsPage"));
const FaceAttendancePage = lazy(() => import("@/pages/face/FaceAttendancePage"));
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
const PendingApprovalsPage = lazy(() => import("@/pages/admin/PendingApprovalsPage"));
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
const DailyReportFormPage = lazy(() => import("@/pages/reports/DailyReportFormPage"));
const DailyReportViewPage = lazy(() => import("@/pages/reports/DailyReportViewPage"));
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
// VIP 초대장 (관리자 발급 / 공개 열람)
const VipInvitePage = lazy(() => import("@/pages/admin/VipInvitePage"));
const PublicVipInvitePage = lazy(() => import("@/pages/PublicVipInvitePage"));
const PublicFeedbackPage = lazy(() => import("@/pages/feedback/PublicFeedbackPage"));
const PublicSparringConsentPage = lazy(() => import("@/pages/sparring/PublicSparringConsentPage"));
const PublicGuestPassPage = lazy(() => import("@/pages/guest/PublicGuestPassPage"));
const PublicCertPage = lazy(() => import("@/pages/cert/PublicCertPage"));

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
          {/* 공개 VIP 초대장 — 로그인 없이 접근 가능 (#d= 데이터) */}
          <Route path="/vip" element={<PublicVipInvitePage />} />
          {/* 공개 회원 의견함 — 키오스크 QR, 로그인 없이 접근 가능 */}
          <Route path="/f/:slug" element={<PublicFeedbackPage />} />
          {/* ⚠️ /s/:slug 는 설문(PublicSurveyPage)이 선점 — 스파링 동의서는 /sp/ 사용 */}
          <Route path="/sp/:slug" element={<PublicSparringConsentPage />} />
          <Route path="/g/:slug" element={<PublicGuestPassPage />} />
          {/* 공개 결제확인서 — 회원 문자 링크, 로그인 없이 접근 가능 */}
          <Route path="/p/:slug" element={<PublicCertPage />} />
          <Route element={<ProtectedRoute />}>
            {/* Kiosk: full-screen, no sidebar/header */}
            <Route path="/kiosk" element={<KioskHomePage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/kpi" element={<KpiDashboardPage />} />
              <Route path="/reports/daily" element={<DailyReportFormPage />} />
              <Route path="/reports/daily/view" element={<DailyReportViewPage />} />
              {/* FC AI Care Center */}
              <Route path="/fc/tasks" element={<FcTaskInboxPage />} />
              <Route path="/fc/revenue-board" element={<RevenueBoardPage />} />
              <Route path="/members" element={<MembersListPage />} />
              <Route path="/members/new" element={<MemberNewPage />} />
              <Route path="/members/import" element={<MemberImportPage />} />
              <Route path="/members/:id" element={<MemberDetailPage />} />
              <Route path="/memberships" element={<MembershipsListPage />} />
              <Route path="/access-logs" element={<AccessLogsPage />} />
              <Route path="/face-attendance" element={<FaceAttendancePage />} />
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
              <Route path="/admin/vip-invitations" element={<VipInvitePage />} />
              <Route path="/admin/alerts" element={<AlertsPage />} />
              <Route path="/admin/revenue" element={<RevenuePage />} />
              <Route path="/admin/notification-logs" element={<NotificationLogsPage />} />
              <Route path="/admin/bulk-notify" element={<BulkNotifyPage />} />
              <Route path="/admin/msg-templates" element={<MessageTemplatesPage />} />
              <Route path="/admin/scheduled-msgs" element={<ScheduledMessagesPage />} />
              <Route path="/admin/send-logs" element={<MessageSendLogsPage />} />
              <Route path="/admin/approvals" element={<PendingApprovalsPage />} />
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

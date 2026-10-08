import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LoginPage } from '../auth/LoginPage';
import { MfaSetupPage, MfaVerifyPage } from '../auth/MfaVerifyPage';
import { RegisterPage } from '../onboarding/RegisterPage';
import { ResumePage } from '../onboarding/ResumePage';
import { ApplicationStatusPage } from '../onboarding/ApplicationStatusPage';
import { AdminDashboard } from '../admin/AdminDashboard';
import { AgencyDashboard } from '../agency/AgencyDashboard';
import { AgentDashboard } from '../agent/AgentDashboard';
import { ApplicationDetailPage } from '../admin/ApplicationDetailPage';
import { ApplicationsPage } from '../admin/ApplicationsPage';
import { AuditLogPage } from '../admin/AuditLogPage';
import { ReportsPage } from '../admin/ReportsPage';
import { AgencyManagementPage } from '../admin/AgencyManagementPage';
import { AgencyDetailPage } from '../admin/AgencyDetailPage';
import { AgentDetailPage } from '../shared/AgentDetailPage';
import { AgentsPage } from '../admin/sections/AgentsPage';
import { ResortsPage } from '../admin/sections/ResortsPage';
import { PricingPage } from '../admin/sections/PricingPage';
import { AdminBookingsPage } from '../admin/sections/AdminBookingsPage';
import { AdminFinancePage } from '../admin/sections/AdminFinancePage';
import { NotificationsPage } from '../admin/sections/NotificationsPage';
import { CrsPage } from '../admin/sections/CrsPage';
import { IntegrationsPage } from '../admin/sections/IntegrationsPage';
import { SecurityPage } from '../admin/sections/SecurityPage';
import { SettingsPage } from '../admin/sections/SettingsPage';
import { SupportPage } from '../admin/sections/SupportPage';
import { InventoryPage } from '../admin/sections/InventoryPage';
import { AgencyAgentsPage } from '../agency/sections/AgencyAgentsPage';
import { AgencyBookingsPage } from '../agency/sections/AgencyBookingsPage';
import { GuestsPage } from '../agency/sections/GuestsPage';
import { AgencyPaymentsPage } from '../agency/sections/AgencyPaymentsPage';
import { AgencyReportsPage } from '../agency/sections/AgencyReportsPage';
import { AgencyNotificationsPage } from '../agency/sections/AgencyNotificationsPage';
import { ProfilePage } from '../agency/sections/ProfilePage';
import { AccountSettingsPage } from '../agency/sections/AccountSettingsPage';
import { AgencySupportPage } from '../agency/sections/AgencySupportPage';
import { AgentBookingsPage } from '../agent/sections/AgentBookingsPage';
import { AgentGuestsPage } from '../agent/sections/AgentGuestsPage';
import { AgentNotificationsPage } from '../agent/sections/AgentNotificationsPage';
import { AgentProfilePage } from '../agent/sections/AgentProfilePage';
import { AgentSupportPage } from '../agent/sections/AgentSupportPage';
import { SearchPage } from '../agent/SearchPage';
import { BookingsPage } from '../agent/BookingsPage';
import { ProtectedRoute } from './ProtectedRoute';

// Built-out admin section pages (ADMIN-only).
const ADMIN_PAGES: { path: string; element: JSX.Element }[] = [
  { path: '/admin/agents', element: <AgentsPage /> },
  { path: '/admin/resorts', element: <ResortsPage /> },
  { path: '/admin/pricing', element: <PricingPage /> },
  { path: '/admin/bookings', element: <AdminBookingsPage /> },
  { path: '/admin/finance', element: <AdminFinancePage /> },
  { path: '/admin/notifications', element: <NotificationsPage /> },
  { path: '/admin/inventory', element: <InventoryPage /> },
  { path: '/admin/crs', element: <CrsPage /> },
  { path: '/admin/integrations', element: <IntegrationsPage /> },
  { path: '/admin/security', element: <SecurityPage /> },
  { path: '/admin/settings', element: <SettingsPage /> },
  { path: '/admin/support', element: <SupportPage /> },
];

// Built-out agency section pages (AGENCY-only).
const AGENCY_PAGES: { path: string; element: JSX.Element }[] = [
  { path: '/agency/agents', element: <AgencyAgentsPage /> },
  { path: '/agency/bookings', element: <AgencyBookingsPage /> },
  { path: '/agency/guests', element: <GuestsPage /> },
  { path: '/agency/payments', element: <AgencyPaymentsPage /> },
  { path: '/agency/reports', element: <AgencyReportsPage /> },
  { path: '/agency/notifications', element: <AgencyNotificationsPage /> },
  { path: '/agency/profile', element: <ProfilePage /> },
  { path: '/agency/settings', element: <AccountSettingsPage /> },
  { path: '/agency/support', element: <AgencySupportPage /> },
];

// Built-out agent (sub-user) section pages (AGENT-only).
const AGENT_PAGES: { path: string; element: JSX.Element }[] = [
  { path: '/agent/bookings', element: <AgentBookingsPage /> },
  { path: '/agent/guests', element: <AgentGuestsPage /> },
  { path: '/agent/notifications', element: <AgentNotificationsPage /> },
  { path: '/agent/profile', element: <AgentProfilePage /> },
  { path: '/agent/support', element: <AgentSupportPage /> },
];

function RoleHome() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;

  switch (user.role) {
    case 'ADMIN':
    case 'VERIFIER':
      return <AdminDashboard />;
    case 'AGENCY':
      return <AgencyDashboard />;
    case 'AGENT':
      return <AgentDashboard />;
  }
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/mfa/verify" element={<MfaVerifyPage />} />
      <Route path="/mfa/setup" element={<MfaSetupPage />} />
      <Route path="/onboarding/register" element={<RegisterPage />} />
      <Route path="/onboarding/resume" element={<ResumePage />} />
      <Route path="/onboarding/status" element={<ApplicationStatusPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <RoleHome />
          </ProtectedRoute>
        }
      />
      <Route
        path="/applications"
        element={
          <ProtectedRoute allowedRoles={['ADMIN', 'VERIFIER']}>
            <ApplicationsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/applications/:id"
        element={
          <ProtectedRoute allowedRoles={['ADMIN', 'VERIFIER']}>
            <ApplicationDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <ReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/audit"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <AuditLogPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/agencies"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <AgencyManagementPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/agencies/:id"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <AgencyDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/agents/:id"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <AgentDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/agency/agents/:id"
        element={
          <ProtectedRoute allowedRoles={['AGENCY']}>
            <AgentDetailPage />
          </ProtectedRoute>
        }
      />
      {ADMIN_PAGES.map(({ path, element }) => (
        <Route
          key={path}
          path={path}
          element={<ProtectedRoute allowedRoles={['ADMIN']}>{element}</ProtectedRoute>}
        />
      ))}
      {AGENCY_PAGES.map(({ path, element }) => (
        <Route
          key={path}
          path={path}
          element={<ProtectedRoute allowedRoles={['AGENCY']}>{element}</ProtectedRoute>}
        />
      ))}
      {AGENT_PAGES.map(({ path, element }) => (
        <Route
          key={path}
          path={path}
          element={<ProtectedRoute allowedRoles={['AGENT']}>{element}</ProtectedRoute>}
        />
      ))}
      {/* Unknown /admin/* URLs fall through to the global "*" redirect below —
          no more fake scaffold pages for routes that don't exist. */}
      <Route
        path="/book"
        element={
          <ProtectedRoute allowedRoles={['AGENT', 'AGENCY']}>
            <SearchPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/bookings"
        element={
          <ProtectedRoute allowedRoles={['AGENT', 'AGENCY']}>
            <BookingsPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { navigationItems } from './routes/navigation';
import { DashboardPage } from './pages/DashboardPage';
import { ModulePlaceholderPage } from './pages/ModulePlaceholderPage';
import { LoginPage } from './pages/LoginPage';
import { AccountSetupPage } from './pages/AccountSetupPage';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { ProjectsPage } from './pages/ProjectsPage';
import { QuotationsPage } from './pages/QuotationsPage';
import { SocietyManagementPage } from './pages/SocietyManagementPage';
import { UserAdministrationPage } from './pages/UserAdministrationPage';
import { BlockchainPage } from './pages/BlockchainPage';
import { GovernanceSettingsPage } from './pages/GovernanceSettingsPage';
import { AuditTrailPage } from './pages/AuditTrailPage';
import { NoticeBoardPage } from './pages/NoticeBoardPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { SocietyMembersPage } from './pages/SocietyMembersPage';
import { ComplaintsPage } from './pages/ComplaintsPage';
import { GovernancePage } from './pages/GovernancePage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<AccountSetupPage />} />
      <Route element={<ProtectedRoute />}>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="quotations" element={<QuotationsPage />} />
        <Route path="meetings" element={<Navigate to="/notices" replace />} />
        <Route path="voting" element={<GovernancePage view="voting" />} />
        <Route path="society/settings/governance" element={<GovernanceSettingsPage />} />
        <Route path="budgets" element={<BudgetsPage />} />
        <Route path="notices" element={<NoticeBoardPage />} />
        <Route path="complaints" element={<ComplaintsPage />} />
        <Route path="audit" element={<AuditTrailPage />} />
        <Route path="administration" element={<Navigate to="/administration/users" replace />} />
        <Route path="administration/societies" element={<SocietyManagementPage />} />
        <Route path="administration/users" element={<UserAdministrationPage />} />
        <Route path="blockchain" element={<BlockchainPage />} />
        <Route element={<ProtectedRoute roles={['SOCIETY_MANAGER']} />}>
          <Route path="members" element={<SocietyMembersPage />} />
        </Route>
        {navigationItems.filter((item) => !['/dashboard', '/projects', '/quotations', '/voting', '/society/settings/governance', '/budgets', '/notices', '/complaints', '/members', '/audit', '/administration/societies', '/administration/users', '/blockchain'].includes(item.path)).map((item) => (
          <Route
            key={item.path}
            path={item.path.slice(1)}
            element={<ModulePlaceholderPage title={item.label} description={item.description} />}
          />
        ))}
        <Route path="*" element={<ModulePlaceholderPage title="Page not found" description="This address does not match a Nivaas application area." />} />
      </Route>
      </Route>
    </Routes>
  );
}

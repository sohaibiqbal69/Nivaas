import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { navigationItems } from './routes/navigation';
import { DashboardPage } from './pages/DashboardPage';
import { ModulePlaceholderPage } from './pages/ModulePlaceholderPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        {navigationItems.filter((item) => item.path !== '/dashboard').map((item) => (
          <Route
            key={item.path}
            path={item.path.slice(1)}
            element={<ModulePlaceholderPage title={item.label} description={item.description} />}
          />
        ))}
        <Route path="*" element={<ModulePlaceholderPage title="Page not found" description="This address does not match a Nivaas application area." />} />
      </Route>
    </Routes>
  );
}

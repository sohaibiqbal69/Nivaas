import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoadingState, PermissionDeniedState } from '@/components/ui/states';
import { useAuth } from '@/contexts/AuthContext';

export function ProtectedRoute({ roles }: { roles?: readonly string[] }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) return <LoadingState label="Resolving your Nivaas session" />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && (!user || !roles.includes(user.role))) return <PermissionDeniedState />;
  return <Outlet />;
}

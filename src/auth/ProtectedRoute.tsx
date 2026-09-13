import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';
import type { Role } from './AuthContext';
import { navConfigByRole } from '../shell/navConfig';

interface ProtectedRouteProps {
  allowedRoles?: Role[];
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, role } = useAuth();

  if (!isAuthenticated || !role) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to={navConfigByRole[role][0].path} replace />;
  }

  return <Outlet />;
}

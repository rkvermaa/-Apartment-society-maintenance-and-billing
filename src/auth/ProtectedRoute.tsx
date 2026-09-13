import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import type { Role } from './AuthContext';
import { navConfigByRole } from '../shell/navConfig';
import { logger } from '../lib/logger';

interface ProtectedRouteProps {
  allowedRoles?: Role[];
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, role } = useAuth();
  const location = useLocation();

  if (!isAuthenticated || !role) {
    logger.warn('auth_redirect_unauthenticated', { path: location.pathname });
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    logger.warn('auth_redirect_role_mismatch', { path: location.pathname, role, allowedRoles });
    return <Navigate to={navConfigByRole[role][0].path} replace />;
  }

  return <Outlet />;
}

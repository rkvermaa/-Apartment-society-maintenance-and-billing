import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppShell } from './shell/AppShell';
import { LoginScreen } from './screens/LoginScreen';
import { AdminDashboardScreen } from './screens/admin/AdminDashboardScreen';
import { AdminMaintenanceScreen } from './screens/admin/AdminMaintenanceScreen';
import { AdminBillingScreen } from './screens/admin/AdminBillingScreen';
import { ResidentDashboardScreen } from './screens/resident/ResidentDashboardScreen';
import { ResidentPaymentsScreen } from './screens/resident/ResidentPaymentsScreen';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/admin/dashboard" element={<AdminDashboardScreen />} />
          <Route path="/admin/maintenance" element={<AdminMaintenanceScreen />} />
          <Route path="/admin/billing" element={<AdminBillingScreen />} />
          <Route path="/resident/dashboard" element={<ResidentDashboardScreen />} />
          <Route path="/resident/payments" element={<ResidentPaymentsScreen />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

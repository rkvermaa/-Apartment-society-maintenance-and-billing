import type { Role } from '../auth/AuthContext';

export interface NavItem {
  id: string;
  label: string;
  path: string;
}

export const navConfigByRole: Record<Role, NavItem[]> = {
  admin: [
    { id: 'admin-dashboard', label: 'Dashboard', path: '/admin/dashboard' },
    { id: 'admin-maintenance', label: 'Maintenance', path: '/admin/maintenance' },
    { id: 'admin-billing', label: 'Billing', path: '/admin/billing' },
  ],
  resident: [
    { id: 'resident-dashboard', label: 'Dashboard', path: '/resident/dashboard' },
    { id: 'resident-payments', label: 'Payments', path: '/resident/payments' },
  ],
};

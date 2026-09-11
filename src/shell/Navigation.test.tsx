import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { renderWithAuth } from '../test-utils';

describe('Navigation', () => {
  it('AC1: shows the same Admin nav items across Admin screens, and never Resident-only items', () => {
    const { unmount } = renderWithAuth(<App />, { role: 'admin', initialEntries: ['/admin/dashboard'] });
    const navAtDashboard = within(screen.getByTestId('app-navigation'));
    expect(navAtDashboard.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(navAtDashboard.getByRole('link', { name: 'Maintenance' })).toBeInTheDocument();
    expect(navAtDashboard.getByRole('link', { name: 'Billing' })).toBeInTheDocument();
    expect(navAtDashboard.queryByRole('link', { name: 'Payments' })).not.toBeInTheDocument();
    unmount();

    renderWithAuth(<App />, { role: 'admin', initialEntries: ['/admin/billing'] });
    const navAtBilling = within(screen.getByTestId('app-navigation'));
    expect(navAtBilling.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(navAtBilling.getByRole('link', { name: 'Maintenance' })).toBeInTheDocument();
    expect(navAtBilling.getByRole('link', { name: 'Billing' })).toBeInTheDocument();
  });

  it('AC1: shows the same Resident nav items across Resident screens, and never Admin-only items', () => {
    const { unmount } = renderWithAuth(<App />, { role: 'resident', initialEntries: ['/resident/dashboard'] });
    const navAtDashboard = within(screen.getByTestId('app-navigation'));
    expect(navAtDashboard.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(navAtDashboard.getByRole('link', { name: 'Payments' })).toBeInTheDocument();
    expect(navAtDashboard.queryByRole('link', { name: 'Maintenance' })).not.toBeInTheDocument();
    expect(navAtDashboard.queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument();
    unmount();

    renderWithAuth(<App />, { role: 'resident', initialEntries: ['/resident/payments'] });
    const navAtPayments = within(screen.getByTestId('app-navigation'));
    expect(navAtPayments.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(navAtPayments.getByRole('link', { name: 'Payments' })).toBeInTheDocument();
  });

  it('AC4: visually indicates the active nav item and updates it on navigation', async () => {
    const user = userEvent.setup();
    renderWithAuth(<App />, { role: 'admin', initialEntries: ['/admin/dashboard'] });

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Billing' })).not.toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('link', { name: 'Billing' }));

    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current', 'page');
  });
});

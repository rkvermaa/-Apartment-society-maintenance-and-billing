import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { renderWithAuth } from '../test-utils';

describe('AppShell', () => {
  it('AC3: navigates client-side between screens without unmounting the shell', async () => {
    const user = userEvent.setup();
    renderWithAuth(<App />, { role: 'admin', initialEntries: ['/admin/dashboard'] });

    const shellBeforeNavigation = screen.getByTestId('app-shell');
    expect(screen.getByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Billing' }));

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeInTheDocument();
    expect(screen.getByTestId('app-shell')).toBe(shellBeforeNavigation);
  });
});

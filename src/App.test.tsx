import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { App } from './App';
import { renderWithAuth } from './test-utils';

describe('App', () => {
  it('AC2: shows only the login screen with no authenticated nav when unauthenticated', () => {
    renderWithAuth(<App />, { role: null, initialEntries: ['/'] });

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-navigation')).not.toBeInTheDocument();
  });

  it('AC5: loads the correct screen within the shell, with the matching nav item active, for a direct URL', () => {
    renderWithAuth(<App />, { role: 'admin', initialEntries: ['/admin/billing'] });

    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Billing' })).toBeInTheDocument();

    const billingLink = screen.getByRole('link', { name: 'Billing' });
    expect(billingLink).toHaveAttribute('aria-current', 'page');
  });
});

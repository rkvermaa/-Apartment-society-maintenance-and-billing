import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { App } from '../App';
import { renderWithAuth } from '../test-utils';

describe('ProtectedRoute', () => {
  it('AC6: redirects an unauthenticated deep link to a protected route to the login screen', () => {
    renderWithAuth(<App />, { role: null, initialEntries: ['/admin/billing'] });

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Billing' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
  });
});

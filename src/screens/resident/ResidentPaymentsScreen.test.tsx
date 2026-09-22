import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResidentPaymentsScreen } from './ResidentPaymentsScreen';
import * as residentBillingClient from './billing/residentBillingClient';
import { renderWithAuth } from '../../test-utils';
import type { Bill } from './billing/residentBillingClient';

vi.mock('./billing/residentBillingClient');

const mockedListMyBills = vi.mocked(residentBillingClient.listMyBills);

beforeEach(() => {
  mockedListMyBills.mockReset();
});

describe('ResidentPaymentsScreen', () => {
  it('shows the resident flat bills and outstanding dues from live data (AC1)', async () => {
    mockedListMyBills.mockResolvedValue([{ id: 1, billingPeriod: '2026-02', amount: 1500, status: 'unpaid' }]);
    renderWithAuth(<ResidentPaymentsScreen />, { role: 'resident', flatId: 12 });

    expect(await screen.findByText('2026-02 — 1500 — unpaid')).toBeInTheDocument();
    expect(screen.getByText('Outstanding dues: 1500')).toBeInTheDocument();
    expect(mockedListMyBills).toHaveBeenCalledWith('resident', 12);
  });

  it('shows a friendly empty state when the flat has no bills yet (AC2)', async () => {
    mockedListMyBills.mockResolvedValue([]);
    renderWithAuth(<ResidentPaymentsScreen />, { role: 'resident', flatId: 12 });

    expect(await screen.findByText('No bills yet for your flat.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a retryable error state when bills fail to load (AC3)', async () => {
    const user = userEvent.setup();
    mockedListMyBills.mockRejectedValueOnce(new Error('Unable to load bills. Please try again.'));
    renderWithAuth(<ResidentPaymentsScreen />, { role: 'resident', flatId: 12 });

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load bills. Please try again.');

    mockedListMyBills.mockResolvedValueOnce([{ id: 2, billingPeriod: '2026-03', amount: 1500, status: 'unpaid' }]);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('2026-03 — 1500 — unpaid')).toBeInTheDocument();
  });

  it('shows a loading state until the bills request resolves (AC4)', async () => {
    let resolveList: (value: Bill[]) => void = () => {};
    mockedListMyBills.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    renderWithAuth(<ResidentPaymentsScreen />, { role: 'resident', flatId: 12 });

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    resolveList([]);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('renders the same bills data the dashboard screen would (AC5)', async () => {
    mockedListMyBills.mockResolvedValue([{ id: 3, billingPeriod: '2026-04', amount: 1800, status: 'paid' }]);
    renderWithAuth(<ResidentPaymentsScreen />, { role: 'resident', flatId: 12 });

    expect(await screen.findByText('2026-04 — 1800 — paid')).toBeInTheDocument();
    expect(mockedListMyBills).toHaveBeenCalledWith('resident', 12);
  });
});

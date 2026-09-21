import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminBillingScreen } from './AdminBillingScreen';
import * as billingClient from './billing/billingClient';
import { renderWithAuth } from '../../test-utils';

vi.mock('./billing/billingClient');

const mockedGenerate = vi.mocked(billingClient.generateMonthlyBills);
const mockedList = vi.mocked(billingClient.listBillsForMonth);

beforeEach(() => {
  mockedGenerate.mockReset();
  mockedList.mockReset();
  mockedList.mockResolvedValue([]);
});

describe('AdminBillingScreen', () => {
  it('informs the admin a bill already exists for a flat (AC3)', async () => {
    const user = userEvent.setup();
    mockedGenerate.mockResolvedValue({
      billingPeriod: '2026-02',
      createdCount: 0,
      alreadyExistingCount: 1,
      failures: [],
    });
    renderWithAuth(<AdminBillingScreen />, { role: 'admin', token: 'test-session-token' });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } });

    await user.click(screen.getByRole('button', { name: 'Generate bills' }));

    expect(await screen.findByText(/already had a bill generated/i)).toBeInTheDocument();
  });

  it('shows a report listing which flats failed, with a reason per flat (AC5, AC6)', async () => {
    const user = userEvent.setup();
    mockedGenerate.mockResolvedValue({
      billingPeriod: '2026-02',
      createdCount: 0,
      alreadyExistingCount: 0,
      failures: [{ flatId: 7, flatLabel: 'A-101', reason: 'amount missing' }],
    });
    renderWithAuth(<AdminBillingScreen />, { role: 'admin', token: 'test-session-token' });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } });

    await user.click(screen.getByRole('button', { name: 'Generate bills' }));

    const failureItem = await screen.findByText('A-101: amount missing');
    expect(failureItem).toBeInTheDocument();
    expect(failureItem).toHaveTextContent('amount missing');
  });

  it('shows a loading indicator while generation is in progress (AC7)', async () => {
    const user = userEvent.setup();
    let resolveGenerate: (value: billingClient.BillGenerationSummary) => void = () => {};
    mockedGenerate.mockReturnValue(
      new Promise((resolve) => {
        resolveGenerate = resolve;
      }),
    );
    renderWithAuth(<AdminBillingScreen />, { role: 'admin', token: 'test-session-token' });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } });

    await user.click(screen.getByRole('button', { name: 'Generate bills' }));
    expect(screen.getByRole('status')).toHaveTextContent(/generating/i);

    resolveGenerate({ billingPeriod: '2026-02', createdCount: 1, alreadyExistingCount: 0, failures: [] });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('disables the trigger action while generation is in progress (AC8)', async () => {
    const user = userEvent.setup();
    let resolveGenerate: (value: billingClient.BillGenerationSummary) => void = () => {};
    mockedGenerate.mockReturnValue(
      new Promise((resolve) => {
        resolveGenerate = resolve;
      }),
    );
    renderWithAuth(<AdminBillingScreen />, { role: 'admin', token: 'test-session-token' });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } });
    const button = screen.getByRole('button', { name: 'Generate bills' });

    await user.click(button);
    expect(button).toBeDisabled();

    resolveGenerate({ billingPeriod: '2026-02', createdCount: 1, alreadyExistingCount: 0, failures: [] });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('shows newly generated bills with an unpaid status in the month list (AC9)', async () => {
    const user = userEvent.setup();
    mockedGenerate.mockResolvedValue({
      billingPeriod: '2026-02',
      createdCount: 1,
      alreadyExistingCount: 0,
      failures: [],
    });
    mockedList.mockResolvedValue([
      { id: 1, flatLabel: 'A-101', billingPeriod: '2026-02', amount: 1500, status: 'unpaid' },
    ]);
    renderWithAuth(<AdminBillingScreen />, { role: 'admin', token: 'test-session-token' });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } });

    await user.click(screen.getByRole('button', { name: 'Generate bills' }));

    expect(await screen.findByText('A-101 — unpaid')).toBeInTheDocument();
  });

  it('shows an error message and re-enables the trigger when generation fails outright', async () => {
    const user = userEvent.setup();
    mockedGenerate.mockRejectedValue(new Error('Something went wrong generating bills. Please try again.'));
    renderWithAuth(<AdminBillingScreen />, { role: 'admin', token: 'test-session-token' });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } });
    const button = screen.getByRole('button', { name: 'Generate bills' });

    await user.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong generating bills. Please try again.');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it('shows an empty-state message for a month with no bills (AC11)', async () => {
    mockedList.mockResolvedValue([]);
    renderWithAuth(<AdminBillingScreen />, { role: 'admin', token: 'test-session-token' });

    expect(await screen.findByText('No bills found for this month.')).toBeInTheDocument();
  });

  it('lists the real bills for the selected month (AC1)', async () => {
    mockedList.mockResolvedValue([
      { id: 5, flatLabel: 'B-202', billingPeriod: '2026-04', amount: 1800, status: 'paid' },
    ]);
    renderWithAuth(<AdminBillingScreen />, { role: 'admin', token: 'test-session-token' });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-04' } });

    expect(await screen.findByText('B-202 — paid')).toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledWith('2026-04', 'test-session-token');
  });

  it('requests bills scoped to only the selected month (AC3)', async () => {
    mockedList.mockResolvedValue([]);
    renderWithAuth(<AdminBillingScreen />, { role: 'admin', token: 'test-session-token' });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-05' } });

    await waitFor(() => expect(mockedList).toHaveBeenLastCalledWith('2026-05', 'test-session-token'));
  });

  it('shows a generic, retryable error message when loading bills fails (AC4)', async () => {
    const user = userEvent.setup();
    mockedList.mockRejectedValueOnce(new Error('Unable to load bills. Please try again.'));
    renderWithAuth(<AdminBillingScreen />, { role: 'admin', token: 'test-session-token' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load bills. Please try again.');

    mockedList.mockResolvedValueOnce([
      { id: 9, flatLabel: 'C-303', billingPeriod: '2026-02', amount: 1200, status: 'unpaid' },
    ]);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('C-303 — unpaid')).toBeInTheDocument();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateMonthlyBills, listBillsForMonth } from './billingClient';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('billingClient', () => {
  it('sends the role and billing period and returns the parsed summary on success (AC1)', async () => {
    const summary = { billingPeriod: '2026-02', createdCount: 1, alreadyExistingCount: 0, failures: [] };
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => summary });

    const result = await generateMonthlyBills('2026-02', 'admin');

    expect(result).toEqual(summary);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/billing/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-user-role': 'admin' }),
        body: JSON.stringify({ billingPeriod: '2026-02' }),
      }),
    );
  });

  it('throws the same generic, retryable error on a failed response and on a network error (AC12)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(generateMonthlyBills('2026-02', 'admin')).rejects.toThrow(
      'Something went wrong generating bills. Please try again.',
    );

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(generateMonthlyBills('2026-02', 'admin')).rejects.toThrow(
      'Something went wrong generating bills. Please try again.',
    );
  });

  it('lists bills for a month using the role header', async () => {
    const bills = [{ id: 1, flatLabel: 'A-101', billingPeriod: '2026-02', amount: 1500, status: 'unpaid' }];
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => bills });

    const result = await listBillsForMonth('2026-02', 'admin');

    expect(result).toEqual(bills);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/billing/bills?month=2026-02',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-user-role': 'admin' }) }),
    );
  });

  it('throws the generic error when listing bills fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    await expect(listBillsForMonth('2026-02', 'resident')).rejects.toThrow(
      'Something went wrong generating bills. Please try again.',
    );
  });
});

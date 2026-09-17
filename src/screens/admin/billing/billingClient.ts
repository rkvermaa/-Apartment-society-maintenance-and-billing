export interface FlatBillFailure {
  flatId: number;
  flatLabel: string;
  reason: string;
}

export interface BillGenerationSummary {
  billingPeriod: string;
  createdCount: number;
  alreadyExistingCount: number;
  failures: FlatBillFailure[];
}

export interface Bill {
  id: number;
  flatLabel: string;
  billingPeriod: string;
  amount: number;
  status: 'unpaid' | 'paid';
}

const GENERIC_ERROR_MESSAGE = 'Something went wrong generating bills. Please try again.';

export async function generateMonthlyBills(
  billingPeriod: string,
  token: string,
): Promise<BillGenerationSummary> {
  let response: Response;
  try {
    response = await fetch('/api/billing/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ billingPeriod }),
    });
  } catch {
    throw new Error(GENERIC_ERROR_MESSAGE);
  }
  if (!response.ok) {
    throw new Error(GENERIC_ERROR_MESSAGE);
  }
  return response.json();
}

export async function listBillsForMonth(billingPeriod: string, token: string): Promise<Bill[]> {
  let response: Response;
  try {
    response = await fetch(`/api/billing/bills?month=${encodeURIComponent(billingPeriod)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error(GENERIC_ERROR_MESSAGE);
  }
  if (!response.ok) {
    throw new Error(GENERIC_ERROR_MESSAGE);
  }
  return response.json();
}

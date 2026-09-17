import type { Role } from '../../../auth/AuthContext';

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

// Placeholder: bill generation has no backing endpoint yet (see server/app.ts, which currently
// only exposes GET /api/bills); once one exists, this must call it, backed by
// db/services/generateMonthlyBills.ts.
export async function generateMonthlyBills(billingPeriod: string): Promise<BillGenerationSummary> {
  throw new Error(`No backend available to generate bills for ${billingPeriod} yet.`);
}

export async function listBillsForMonth(billingPeriod: string, role: Role | null): Promise<Bill[]> {
  let response: Response;
  try {
    response = await fetch(`/api/bills?month=${encodeURIComponent(billingPeriod)}`, {
      headers: role ? { 'X-Demo-Role': role } : {},
    });
  } catch {
    throw new Error('Unable to load bills. Please try again.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('You do not have permission to view bills.');
  }
  if (!response.ok) {
    throw new Error('Unable to load bills. Please try again.');
  }
  return response.json();
}

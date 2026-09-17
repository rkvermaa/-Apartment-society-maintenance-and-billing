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

// Placeholder billing client for the admin billing screen. This story added a real HTTP API
// layer (server/app.ts) for authentication only; billing has no API yet — once one exists,
// these must call it directly, backed by db/services/generateMonthlyBills.ts.
export async function generateMonthlyBills(billingPeriod: string): Promise<BillGenerationSummary> {
  throw new Error(`No backend available to generate bills for ${billingPeriod} yet.`);
}

export async function listBillsForMonth(_billingPeriod: string): Promise<Bill[]> {
  return [];
}

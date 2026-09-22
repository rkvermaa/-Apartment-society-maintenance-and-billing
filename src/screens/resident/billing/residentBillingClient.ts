import type { Role } from '../../../auth/AuthContext';

export interface Bill {
  id: number;
  billingPeriod: string;
  amount: number;
  status: 'unpaid' | 'paid';
}

export async function listMyBills(
  role: Role | null,
  flatId: number | null,
  username: string | null,
): Promise<Bill[]> {
  let response: Response;
  try {
    response = await fetch('/api/bills/mine', {
      headers: {
        ...(role ? { 'X-Demo-Role': role } : {}),
        ...(flatId != null ? { 'X-Demo-Flat-Id': String(flatId) } : {}),
        ...(username ? { 'X-Demo-Username': username } : {}),
      },
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

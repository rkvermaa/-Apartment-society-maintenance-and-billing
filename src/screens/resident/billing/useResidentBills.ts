import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../auth/useAuth';
import { listMyBills, type Bill } from './residentBillingClient';

export interface ResidentBillsState {
  status: 'loading' | 'error' | 'ready';
  bills: Bill[];
  errorMessage: string | null;
  reload: () => void;
}

export function useResidentBills(): ResidentBillsState {
  const { role, flatId } = useAuth();
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [bills, setBills] = useState<Bill[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      setBills(await listMyBills(role, flatId));
      setStatus('ready');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load bills. Please try again.');
      setStatus('error');
    }
  }, [role, flatId]);

  useEffect(() => {
    load();
  }, [load]);

  return { status, bills, errorMessage, reload: load };
}

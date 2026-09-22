import { useResidentBills } from './billing/useResidentBills';

export function ResidentDashboardScreen() {
  const { status, bills, errorMessage, reload } = useResidentBills();
  const outstandingTotal = bills
    .filter((bill) => bill.status !== 'paid')
    .reduce((sum, bill) => sum + bill.amount, 0);

  return (
    <section>
      <h1>Resident Dashboard</h1>
      {status === 'loading' && <p role="status">Loading your bills…</p>}
      {status === 'error' && (
        <div role="alert">
          <p>{errorMessage}</p>
          <button type="button" onClick={reload}>
            Retry
          </button>
        </div>
      )}
      {status === 'ready' && bills.length === 0 && <p>No bills yet for your flat.</p>}
      {status === 'ready' && bills.length > 0 && (
        <>
          <p>Outstanding dues: {outstandingTotal}</p>
          <ul>
            {bills.map((bill) => (
              <li key={bill.id}>
                {bill.billingPeriod} — {bill.amount} — {bill.status}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

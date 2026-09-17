import { useEffect, useState } from 'react';
import {
  generateMonthlyBills,
  listBillsForMonth,
  type Bill,
  type BillGenerationSummary,
} from './billing/billingClient';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function AdminBillingScreen() {
  const [month, setMonth] = useState(currentMonth);
  const [isGenerating, setIsGenerating] = useState(false);
  const [summary, setSummary] = useState<BillGenerationSummary | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!month) return;
    listBillsForMonth(month).then(setBills);
  }, [month]);

  async function handleGenerate() {
    setIsGenerating(true);
    setErrorMessage(null);
    try {
      const result = await generateMonthlyBills(month);
      setSummary(result);
      setBills(await listBillsForMonth(month));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Bill generation failed.');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section>
      <h1>Billing</h1>
      <label htmlFor="billing-month">Month</label>
      <input
        id="billing-month"
        type="month"
        value={month}
        onChange={(event) => setMonth(event.target.value)}
      />
      <button type="button" onClick={handleGenerate} disabled={isGenerating || !month}>
        Generate bills
      </button>
      {isGenerating && <p role="status">Generating bills…</p>}
      {errorMessage && <p role="alert">{errorMessage}</p>}
      {summary && summary.alreadyExistingCount > 0 && (
        <p>{summary.alreadyExistingCount} flat(s) already had a bill generated for this month.</p>
      )}
      {summary && summary.failures.length > 0 && (
        <div role="alert" aria-label="Bill generation failures">
          <h2>Some bills failed to generate</h2>
          <ul>
            {summary.failures.map((failure) => (
              <li key={failure.flatId}>
                {failure.flatLabel}: {failure.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <h2>Bills for {month}</h2>
      {bills.length === 0 ? (
        <p>No bills found for this month.</p>
      ) : (
        <ul>
          {bills.map((bill) => (
            <li key={bill.id}>
              {bill.flatLabel} — {bill.status}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

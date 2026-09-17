import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { listFlats, updateFlat, type Flat } from './maintenance/flatsClient';

export function AdminMaintenanceScreen() {
  const { token } = useAuth();
  const actor = { token: token ?? '' };
  const [flats, setFlats] = useState<Flat[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    listFlats(actor).then(setFlats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function label(flat: Flat) {
    return `${flat.block}-${flat.flatNumber}`;
  }

  async function handleSaveAmount(flat: Flat) {
    const raw = drafts[flat.id] ?? String(flat.monthlyMaintenanceAmount ?? '');
    try {
      const updated = await updateFlat(actor, flat.id, { monthlyMaintenanceAmount: Number(raw) });
      setFlats((prev) => prev.map((f) => (f.id === flat.id ? updated : f)));
      setErrors((prev) => ({ ...prev, [flat.id]: '' }));
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        [flat.id]: error instanceof Error ? error.message : 'Update failed.',
      }));
    }
  }

  async function handleToggleActive(flat: Flat) {
    try {
      const updated = await updateFlat(actor, flat.id, { isActive: !flat.isActive });
      setFlats((prev) => prev.map((f) => (f.id === flat.id ? updated : f)));
      setErrors((prev) => ({ ...prev, [flat.id]: '' }));
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        [flat.id]: error instanceof Error ? error.message : 'Update failed.',
      }));
    }
  }

  return (
    <section>
      <h1>Maintenance</h1>
      <table>
        <tbody>
          {flats.map((flat) => (
            <tr key={flat.id}>
              <td>{label(flat)}</td>
              <td>
                <button type="button" onClick={() => handleToggleActive(flat)}>
                  {flat.isActive ? 'Active' : 'Inactive'}
                </button>
              </td>
              <td>
                <input
                  aria-label={`Monthly amount for ${label(flat)}`}
                  type="number"
                  value={drafts[flat.id] ?? String(flat.monthlyMaintenanceAmount ?? '')}
                  onChange={(event) =>
                    setDrafts((prev) => ({ ...prev, [flat.id]: event.target.value }))
                  }
                />
                <button type="button" onClick={() => handleSaveAmount(flat)}>
                  {`Save ${label(flat)}`}
                </button>
                {errors[flat.id] && <p role="alert">{errors[flat.id]}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export interface Flat {
  id: number;
  flatNumber: string;
  block: string;
  isActive: boolean;
  monthlyMaintenanceAmount: number | null;
}

export interface Actor {
  token: string;
}

function actorHeaders(actor: Actor): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${actor.token}`,
  };
}

export async function listFlats(actor: Actor): Promise<Flat[]> {
  const res = await fetch('/api/flats', { headers: actorHeaders(actor) });
  if (!res.ok) throw new Error('Failed to load flats.');
  return res.json();
}

export async function updateFlat(
  actor: Actor,
  flatId: number,
  patch: Partial<Pick<Flat, 'isActive' | 'monthlyMaintenanceAmount'>>,
): Promise<Flat> {
  const res = await fetch(`/api/flats/${flatId}`, {
    method: 'PATCH',
    headers: actorHeaders(actor),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? 'Failed to update flat.');
  }
  return res.json();
}

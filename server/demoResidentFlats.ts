export interface DemoResidentFlat {
  username: string;
  flatId: number;
}

// Server-side half of the same interim, explicitly-not-a-real-security-boundary trust model
// documented in requireRole(): mirrors the resident entries of src/auth/credentials.ts's
// DEMO_USERS (username -> flatId only) so the server can resolve which flat an asserted demo
// identity is actually allowed to see, instead of trusting a client-supplied flatId value
// directly (that alone would let any caller with the "resident" role read any flat's bills by
// guessing a different flat id).
const DEMO_RESIDENT_FLATS: DemoResidentFlat[] = [{ username: 'resident', flatId: 1 }];

export function resolveDemoResidentFlatId(username: string): number | null {
  const match = DEMO_RESIDENT_FLATS.find((candidate) => candidate.username === username);
  return match ? match.flatId : null;
}

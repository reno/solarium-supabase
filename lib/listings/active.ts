// A listing counts as active only while status='active' AND it hasn't expired. Kept in
// lib so the Date.now() check stays out of React server-component bodies (purity lint).
export function activeListing<T extends { status: string; expires_at?: string | null }>(
  listings: T[] | null | undefined
): T | undefined {
  const now = Date.now();
  return (listings ?? []).find(
    (l) => l.status === "active" && (!l.expires_at || new Date(l.expires_at).getTime() > now)
  );
}

/** True when a collection's items are still unrevealed (reveal_at set and in the future). */
export function isUnrevealed(revealAt: string | null | undefined): boolean {
  return !!revealAt && new Date(revealAt).getTime() > Date.now();
}

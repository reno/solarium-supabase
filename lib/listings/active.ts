export function activeListing<T extends { status: string; expires_at?: string | null }>(
  listings: T[] | null | undefined
): T | undefined {
  const now = Date.now();
  return (listings ?? []).find(
    (l) => l.status === "active" && (!l.expires_at || new Date(l.expires_at).getTime() > now)
  );
}

export function isUnrevealed(revealAt: string | null | undefined): boolean {
  return !!revealAt && new Date(revealAt).getTime() > Date.now();
}

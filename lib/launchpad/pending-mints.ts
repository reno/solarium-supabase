/**
 * Mints that landed on chain but were never recorded off chain.
 *
 * The asset is the buyer's the moment their transaction confirms; the `nfts` row only exists once
 * `candy-mint` has re-derived it from the chain. Anything that interrupts that second step — a
 * dropped connection, an RPC the function momentarily could not resolve, a closed tab — leaves
 * the buyer holding an item the app cannot see, and with no way back: minting again would cost
 * them a second item rather than recovering the first.
 *
 * So the mint is kept here until it is recorded. Replaying one is always safe: `candy-mint` is
 * idempotent on the asset address and returns the existing row rather than inserting twice, so a
 * record left stale by another tab costs nothing to retry.
 *
 * Exposed as an external store rather than a plain read, so the notice can render nothing on the
 * server (where local storage doesn't exist) and still update the moment a record is added or
 * cleared — including from another tab.
 */

const KEY = "solarium.pending-mints";

export type PendingMint = {
  collectionId: string;
  assetAddress: string;
  signature: string;
  at: string;
};

// Every access is wrapped: this runs during a mint, and a browser that refuses storage (private
// mode, a blocked origin) must not turn a successful mint into a thrown error.
function rawValue(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): PendingMint[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingMint[]).filter((r) => r?.assetAddress && r?.signature) : [];
  } catch {
    return [];
  }
}

// useSyncExternalStore re-renders whenever the snapshot's identity changes, so the parsed array is
// cached against the raw string it came from — otherwise every render would produce a new array
// and loop forever.
let cachedRaw: string | null = null;
let cached: PendingMint[] = [];

export const NO_PENDING_MINTS: PendingMint[] = [];

export function pendingMintsSnapshot(): PendingMint[] {
  const raw = rawValue();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parse(raw);
  }
  return cached;
}

const listeners = new Set<() => void>();

export function subscribePendingMints(listener: () => void): () => void {
  listeners.add(listener);
  // A "storage" event only fires in *other* tabs, which is exactly the case local writes miss.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function write(records: PendingMint[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* storage unavailable — the mint still succeeded, it just can't be retried from here */
  }
  for (const listener of listeners) listener();
}

export function savePendingMint(record: Omit<PendingMint, "at">): void {
  const existing = pendingMintsSnapshot().filter((r) => r.assetAddress !== record.assetAddress);
  write([...existing, { ...record, at: new Date().toISOString() }]);
}

export function clearPendingMint(assetAddress: string): void {
  write(pendingMintsSnapshot().filter((r) => r.assetAddress !== assetAddress));
}

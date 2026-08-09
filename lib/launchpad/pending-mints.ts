const KEY = "solarium.pending-mints";

export type PendingMint = {
  collectionId: string;
  assetAddress: string;
  signature: string;
  at: string;
};

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

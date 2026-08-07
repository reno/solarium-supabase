const FALLBACK_SOL_USD = 148.62;

// Live SOL/USD for fiat lines and the nav ticker. Fetched server-side and cached ~60s via
// Next's fetch cache; falls back to a constant if the source is unreachable (e.g. offline
// local dev), so callers never fail on the price.
export async function getSolUsd(): Promise<number> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return FALLBACK_SOL_USD;
    const data = (await res.json()) as { solana?: { usd?: number } };
    const p = data?.solana?.usd;
    return typeof p === "number" && p > 0 ? p : FALLBACK_SOL_USD;
  } catch {
    return FALLBACK_SOL_USD;
  }
}

/** "$1,234" from a SOL amount and the live price. */
export function fiat(sol: number, solUsd: number): string {
  return `$${Math.round(sol * solUsd).toLocaleString("en-US")}`;
}

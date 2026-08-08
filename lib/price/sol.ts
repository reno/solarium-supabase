const FALLBACK_SOL_USD = 148.62;

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

export function fiat(sol: number, solUsd: number): string {
  return `$${Math.round(sol * solUsd).toLocaleString("en-US")}`;
}

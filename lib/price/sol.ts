const FALLBACK_SOL_USD = 148.62;

const ENDPOINT =
  "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";

// Server-only: every caller is a server component, so the key never reaches the
// browser. Optional — without it the same endpoint works on CoinGecko's keyless
// public tier, which is rate-limited per IP.
function apiKeyHeader(): Record<string, string> {
  const key = process.env.COINGECKO_API_KEY;
  return key ? { "x-cg-demo-api-key": key } : {};
}

export async function getSolUsd(): Promise<number> {
  try {
    const res = await fetch(ENDPOINT, {
      headers: apiKeyHeader(),
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      console.warn(
        `[sol-usd] CoinGecko returned ${res.status}; using fallback $${FALLBACK_SOL_USD}`
      );
      return FALLBACK_SOL_USD;
    }
    const data = (await res.json()) as { solana?: { usd?: number } };
    const p = data?.solana?.usd;
    if (typeof p === "number" && p > 0) return p;
    console.warn(
      `[sol-usd] CoinGecko body had no usable price; using fallback $${FALLBACK_SOL_USD}`
    );
    return FALLBACK_SOL_USD;
  } catch (err) {
    console.warn(
      `[sol-usd] CoinGecko request failed; using fallback $${FALLBACK_SOL_USD}`,
      err
    );
    return FALLBACK_SOL_USD;
  }
}

export function fiat(sol: number, solUsd: number): string {
  return `$${Math.round(sol * solUsd).toLocaleString("en-US")}`;
}

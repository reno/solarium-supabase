// The marketplace fee — defined once, for both runtimes.
//
// This lives under supabase/functions/_shared/ because it is the only directory
// both sides can reach: the settle Edge Function (Deno) can only bundle files
// from under supabase/functions/, while Next.js can import from anywhere in the
// repo. Deno imports it as "../_shared/fee.ts", the app as
// "@/supabase/functions/_shared/fee".
//
// Keep this file dependency-free. tsconfig.json excludes supabase/functions, so
// it is only typechecked by virtue of being imported; a Deno-only import added
// here would break the Next build.

/** Marketplace fee in basis points, charged to the buyer on top of the listed price. */
export const FEE_BPS = 100n;

/** The fee in lamports for a price in lamports. Integer math — never floats for money. */
export function feeOf(price: bigint): bigint {
  return (price * FEE_BPS) / 10000n;
}

/** Fractional rate, for display math over SOL floats. Never use this to build a transaction. */
export const FEE_RATE = Number(FEE_BPS) / 10000;

/** Human-readable rate, e.g. "1.0%". */
export const FEE_LABEL = `${(Number(FEE_BPS) / 100).toFixed(1)}%`;

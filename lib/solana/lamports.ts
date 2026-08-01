export const LAMPORTS_PER_SOL = 1_000_000_000n;

export function lamportsToSol(lamports: bigint): string {
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = (abs % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function solToLamports(sol: string): bigint {
  const trimmed = sol.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,9}))?$/.exec(trimmed);
  if (!match) throw new Error(`Invalid SOL amount: ${sol}`);
  const [, sign, whole, frac = ""] = match;
  const lamports =
    BigInt(whole) * LAMPORTS_PER_SOL + BigInt(frac.padEnd(9, "0"));
  return sign === "-" ? -lamports : lamports;
}

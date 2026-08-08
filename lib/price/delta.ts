export function deltaBps(current: bigint, previous: bigint): number | null {
  if (previous > 0n) return Math.round((Number(current - previous) / Number(previous)) * 10000);
  if (current > 0n) return 10000;
  return null;
}

export function deltaLabel(bps: number | null): string {
  if (bps === null) return "—";
  return `${bps < 0 ? "−" : "+"}${Math.abs(bps / 100).toFixed(1)}%`;
}

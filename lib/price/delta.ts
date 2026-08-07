/**
 * 24h change in basis points, from the current window's sale volume and the one before it.
 *
 * Computed on read rather than cached: the figure is defined by a sliding clock window, so a
 * stored copy is wrong the moment the window moves even if nothing traded. Mirrors the SQL in
 * refresh_collection_stats, including its "volume with no prior baseline is +100%" convention.
 *
 * Returns null when there is nothing to compare — no trades in either window — so callers can
 * render "—" instead of a confident 0%.
 */
export function deltaBps(current: bigint, previous: bigint): number | null {
  if (previous > 0n) return Math.round((Number(current - previous) / Number(previous)) * 10000);
  if (current > 0n) return 10000;
  return null;
}

/** "+12.4%" / "−3.1%" (U+2212 for the minus), or "—" for no comparison. */
export function deltaLabel(bps: number | null): string {
  if (bps === null) return "—";
  return `${bps < 0 ? "−" : "+"}${Math.abs(bps / 100).toFixed(1)}%`;
}

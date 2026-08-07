/** The server's clock in epoch seconds, for components that render a countdown. Lives in lib so
 *  the Date.now() call stays out of React server-component bodies (purity lint). */
export function serverNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** Abbreviated relative time in Solarium's terse style: "now", "12s", "2m", "14h", "3d",
 *  falling back to weeks then an absolute date for anything older. Used by ActivityRow feeds. */
export function relativeTime(input: string | number | Date): string {
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 5) return "now";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

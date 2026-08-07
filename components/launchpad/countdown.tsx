"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
}
function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** Live HH:MM:SS (or Dd HH:MM:SS) countdown to a target ISO time. Uses an external store
 *  so the tick doesn't rely on setState-in-effect.
 *
 *  `now` is the server's clock in epoch seconds, from `serverNow()` in the page. It is what the
 *  server renders with AND what the client hydrates with, so the first paint shows the real
 *  remaining time and the markup still matches; the ticking value takes over right after.
 *  Without it the server snapshot has no clock at all, and the countdown paints the target's
 *  full epoch ("20686d …") until hydration corrects it. */
export function Countdown({ target, now: serverNow, style }: { target: string; now: number; style?: React.CSSProperties }) {
  const now = useSyncExternalStore(subscribe, nowSeconds, () => serverNow);
  const total = Math.max(0, Math.floor(new Date(target).getTime() / 1000) - now);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", ...style }}>{text}</span>
  );
}

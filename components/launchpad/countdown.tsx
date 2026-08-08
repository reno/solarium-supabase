"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
}
function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

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

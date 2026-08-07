"use client";

import { useEffect, useState, type HTMLAttributes } from "react";

const CDN = "https://cdn.jsdelivr.net/npm/lucide-static@0.451.0/icons";
const cache: Record<string, string> = {};

export interface IconProps extends HTMLAttributes<HTMLSpanElement> {
  /** Lucide icon name, kebab-case (e.g. "wallet", "trending-up"). */
  name: string;
  /** Pixel box. 16 default, 20 in nav, 14 inline with text. */
  size?: number;
  /** Defaults to currentColor — icons never carry their own color. */
  color?: string;
}

/** Lucide outline glyph, inlined so it inherits currentColor and stroke weight. */
export function Icon({ name, size = 16, color, style, ...rest }: IconProps) {
  // Cache hits are derived at render time so the effect below never needs to setState
  // synchronously for them — it only fetches (and sets state) on an actual cache miss.
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const svg = cache[name] ?? fetched[name] ?? "";

  useEffect(() => {
    if (cache[name]) return;
    let alive = true;
    fetch(`${CDN}/${name}.svg`)
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => {
        const out = t.replace("<svg", '<svg style="width:100%;height:100%;display:block"');
        cache[name] = out;
        if (alive) setFetched((f) => ({ ...f, [name]: out }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [name]);

  return (
    <span
      aria-hidden="true"
      {...rest}
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        flex: "0 0 auto",
        color: color || "currentColor",
        ...style,
      }}
    />
  );
}

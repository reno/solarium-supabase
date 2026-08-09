"use client";

import { useEffect, useState, type HTMLAttributes } from "react";

const CDN = "https://cdn.jsdelivr.net/npm/lucide-static@0.451.0/icons";
const cache: Record<string, string> = {};

const ICON_NAME = /^[a-z0-9-]{1,64}$/;

function scrubSvg(markup: string): string {
  return markup
    .replace(/<\s*(script|foreignObject)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|foreignObject)\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, "");
}

export interface IconProps extends HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 16, color, style, ...rest }: IconProps) {
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const svg = cache[name] ?? fetched[name] ?? "";

  useEffect(() => {
    if (cache[name] || !ICON_NAME.test(name)) return;
    let alive = true;
    fetch(`${CDN}/${encodeURIComponent(name)}.svg`)
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => {
        const out = scrubSvg(t).replace("<svg", '<svg style="width:100%;height:100%;display:block"');
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

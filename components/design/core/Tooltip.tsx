"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

export interface TooltipProps {
  content: ReactNode;
  side?: "top" | "bottom";
  children: ReactNode;
  style?: CSSProperties;
}

export function Tooltip({ content, side = "top", children, style }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const pos: CSSProperties =
    side === "top"
      ? { bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" }
      : { top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" };
  return (
    <span onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} style={{ position: "relative", display: "inline-flex", ...style }}>
      {children}
      {open ? (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            ...pos,
            zIndex: 60,
            whiteSpace: "nowrap",
            background: "var(--surface-overlay)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-sm)",
            boxShadow: "var(--shadow-raised)",
            padding: "var(--space-3) var(--space-5)",
            fontSize: "var(--text-xs)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}

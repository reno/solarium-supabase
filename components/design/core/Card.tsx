"use client";

import { useState, type HTMLAttributes, type ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Body padding; pass 0 for edge-to-edge tables. */
  padding?: string | number;
  /** Border brightens on hover. */
  interactive?: boolean;
  header?: ReactNode;
}

export function Card({ padding = "var(--space-7)", interactive, header, children, style, ...rest }: CardProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => interactive && setHover(false)}
      {...rest}
      style={{
        background: "var(--surface-card)",
        border: `1px solid ${hover ? "var(--border-strong)" : "var(--border-subtle)"}`,
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        transition: "border-color var(--dur-fast) var(--ease-out)",
        cursor: interactive ? "pointer" : undefined,
        overflow: "hidden",
        ...style,
      }}
    >
      {header ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "var(--space-6) var(--space-7)",
            borderBottom: "1px solid var(--border-subtle)",
            font: "var(--type-label)",
            fontSize: "var(--text-md)",
            color: "var(--text-primary)",
          }}
        >
          {header}
        </div>
      ) : null}
      <div style={{ padding }}>{children}</div>
    </div>
  );
}

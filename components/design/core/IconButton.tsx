"use client";

import { useState, type ButtonHTMLAttributes, type CSSProperties } from "react";

import { Icon } from "./Icon";

const H: Record<string, number> = { sm: 28, md: 34, lg: 42 };

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "solid";
  active?: boolean;
  label: string;
}

export function IconButton({ icon, size = "md", variant = "ghost", active, label, style, ...rest }: IconButtonProps) {
  const [hover, setHover] = useState(false);
  const base: CSSProperties =
    variant === "solid"
      ? { background: "var(--surface-2)", border: "1px solid var(--border-default)" }
      : { background: "transparent", border: "1px solid transparent" };
  return (
    <button
      aria-label={label}
      title={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: H[size],
        height: H[size],
        borderRadius: "var(--radius-control)",
        cursor: "pointer",
        transition: "var(--transition-control)",
        color: active ? "var(--accent)" : "var(--text-secondary)",
        ...base,
        ...(active ? { background: "var(--accent-quiet)", border: "1px solid var(--accent)" } : null),
        ...(hover && !active ? { background: "var(--surface-hover)", color: "var(--text-primary)" } : null),
        ...style,
      }}
    >
      <Icon name={icon} size={size === "sm" ? 14 : size === "lg" ? 18 : 16} />
    </button>
  );
}

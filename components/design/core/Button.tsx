"use client";

import { useState, type ButtonHTMLAttributes, type CSSProperties } from "react";

import { Icon } from "./Icon";

const H: Record<string, string> = { sm: "var(--control-h-sm)", md: "var(--control-h-md)", lg: "var(--control-h-lg)" };
const PAD: Record<string, string> = { sm: "0 10px", md: "0 14px", lg: "0 20px" };
const FS: Record<string, string> = { sm: "var(--text-xs)", md: "var(--text-md)", lg: "var(--text-base)" };

const VARIANTS: Record<string, CSSProperties> = {
  primary: { background: "var(--accent)", color: "var(--text-on-accent)", border: "1px solid transparent" },
  secondary: { background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-default)" },
  ghost: { background: "transparent", color: "var(--text-secondary)", border: "1px solid transparent" },
  outline: { background: "transparent", color: "var(--accent)", border: "1px solid var(--accent)" },
  bid: { background: "var(--accent-2-quiet)", color: "var(--accent-2)", border: "1px solid var(--accent-2)" },
  danger: { background: "var(--price-down-bg)", color: "var(--price-down)", border: "1px solid var(--price-down)" },
};
const HOVER: Record<string, CSSProperties> = {
  primary: { background: "var(--accent-hover)" },
  secondary: { background: "var(--surface-hover)", border: "1px solid var(--border-strong)" },
  ghost: { background: "var(--surface-hover)", color: "var(--text-primary)" },
  outline: { background: "var(--accent-quiet)" },
  bid: { background: "var(--accent-2)", color: "var(--text-on-accent)" },
  danger: { background: "var(--price-down)", color: "var(--text-on-accent)" },
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "outline" | "bid" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: string;
  iconRight?: string;
  block?: boolean;
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  block,
  loading,
  disabled,
  children,
  style,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const v = VARIANTS[variant] || VARIANTS.secondary;
  const on = hover && !disabled && !loading ? HOVER[variant] : null;
  return (
    <button
      disabled={disabled || loading}
      onMouseEnter={(e) => {
        setHover(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHover(false);
        onMouseLeave?.(e);
      }}
      {...rest}
      style={{
        display: block ? "flex" : "inline-flex",
        width: block ? "100%" : undefined,
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-3)",
        height: H[size],
        padding: PAD[size],
        borderRadius: "var(--radius-control)",
        font: "var(--type-label)",
        fontSize: FS[size],
        fontWeight: "var(--weight-semibold)",
        fontFamily: "var(--font-sans)",
        cursor: disabled ? "not-allowed" : "pointer",
        whiteSpace: "nowrap",
        transition: "var(--transition-control)",
        ...v,
        ...(disabled
          ? { background: "var(--surface-2)", color: "var(--text-disabled)", border: "1px solid var(--border-subtle)" }
          : null),
        ...on,
        ...style,
      }}
    >
      {loading ? (
        <span style={{ fontFamily: "var(--font-mono)" }}>…</span>
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === "sm" ? 13 : 15} /> : null}
          {children}
          {iconRight ? <Icon name={iconRight} size={size === "sm" ? 13 : 15} /> : null}
        </>
      )}
    </button>
  );
}

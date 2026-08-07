import type { CSSProperties } from "react";

const SIZES: Record<string, { v: string; f: string }> = {
  sm: { v: "var(--text-md)", f: "var(--text-2xs)" },
  md: { v: "var(--text-lg)", f: "var(--text-xs)" },
  lg: { v: "var(--text-2xl)", f: "var(--text-md)" },
};

export interface PriceDisplayProps {
  amount: string | number;
  currency?: "SOL" | "USDC" | string;
  fiat?: string;
  label?: string;
  size?: "sm" | "md" | "lg";
  tone?: "up" | "down";
  inline?: boolean;
  style?: CSSProperties;
}

export function PriceDisplay({ amount, currency = "SOL", fiat, label, size = "md", tone, inline, style }: PriceDisplayProps) {
  const s = SIZES[size] || SIZES.md;
  const color = tone === "up" ? "var(--price-up)" : tone === "down" ? "var(--price-down)" : "var(--text-primary)";
  return (
    <div
      style={{
        display: inline ? "inline-flex" : "flex",
        flexDirection: inline ? "row" : "column",
        alignItems: inline ? "baseline" : "flex-start",
        gap: inline ? "var(--space-4)" : "var(--space-1)",
        ...style,
      }}
    >
      {label ? (
        <span
          style={{
            font: "var(--type-label)",
            fontSize: "var(--text-2xs)",
            textTransform: "uppercase",
            letterSpacing: "var(--tracking-label)",
            color: "var(--text-tertiary)",
          }}
        >
          {label}
        </span>
      ) : null}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
          fontSize: s.v,
          fontWeight: "var(--weight-semibold)",
          color,
          letterSpacing: "var(--tracking-mono)",
          whiteSpace: "nowrap",
        }}
      >
        {amount}
        <span style={{ fontSize: "0.78em", marginLeft: 4, color: "var(--text-secondary)" }}>{currency}</span>
      </span>
      {fiat ? (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: s.f, color: "var(--text-tertiary)" }}>{fiat}</span>
      ) : null}
    </div>
  );
}

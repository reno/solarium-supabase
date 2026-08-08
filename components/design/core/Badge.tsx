import type { CSSProperties, HTMLAttributes } from "react";

const TONES: Record<string, { background: string; color: string; border: string }> = {
  neutral: { background: "var(--surface-3)", color: "var(--text-secondary)", border: "var(--border-subtle)" },
  accent: { background: "var(--accent-quiet)", color: "var(--accent)", border: "var(--accent)" },
  cyan: { background: "var(--accent-2-quiet)", color: "var(--accent-2)", border: "var(--accent-2)" },
  up: { background: "var(--price-up-bg)", color: "var(--price-up)", border: "transparent" },
  down: { background: "var(--price-down-bg)", color: "var(--price-down)", border: "transparent" },
  live: { background: "var(--price-up-bg)", color: "var(--price-up)", border: "transparent" },
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "accent" | "cyan" | "up" | "down" | "live";
  dot?: boolean;
  mono?: boolean;
}

export function Badge({ tone = "neutral", children, dot, mono, style, ...rest }: BadgeProps) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-3)",
        height: 20,
        padding: "0 var(--space-4)",
        borderRadius: "var(--radius-pill)",
        background: t.background,
        color: t.color,
        border: `1px solid ${t.border}`,
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-semibold)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot ? (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "var(--radius-pill)",
            background: "currentColor",
            boxShadow: tone === "live" ? "var(--glow-live)" : undefined,
            animation: tone === "live" ? ("sol-pulse 1.4s var(--ease-in-out) infinite" as CSSProperties["animation"]) : undefined,
          }}
        />
      ) : null}
      {children}
    </span>
  );
}

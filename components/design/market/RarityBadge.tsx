import type { CSSProperties } from "react";

export interface RarityBadgeProps {
  /** Rarity rank, 1 = rarest. */
  rank: number | string;
  /** Collection supply, rendered as "/8192". */
  total?: number | string;
  style?: CSSProperties;
}

export function RarityBadge({ rank, total, style }: RarityBadgeProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        height: 18,
        padding: "0 var(--space-4)",
        borderRadius: "var(--radius-xs)",
        background: "var(--surface-overlay)",
        border: "1px solid var(--border-default)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-2xs)",
        color: "var(--text-secondary)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span style={{ color: "var(--accent)" }}>◈</span>
      {rank}
      {total ? <span style={{ color: "var(--text-tertiary)" }}>/{total}</span> : null}
    </span>
  );
}

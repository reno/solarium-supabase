import type { CSSProperties } from "react";

export interface CollectionStat {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
}

export interface CollectionStatsBarProps {
  stats: CollectionStat[];
  compact?: boolean;
  style?: CSSProperties;
}

function Stat({ label, value, sub, tone }: CollectionStat) {
  const color = tone === "up" ? "var(--price-up)" : tone === "down" ? "var(--price-down)" : "var(--text-primary)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 72 }}>
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
      <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)", color }}>
        {value}
      </span>
      {sub ? <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>{sub}</span> : null}
    </div>
  );
}

export function CollectionStatsBar({ stats = [], compact, style }: CollectionStatsBarProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? "var(--space-9)" : "var(--space-11)",
        flexWrap: "wrap",
        ...style,
      }}
    >
      {stats.map((s, i) => (
        <Stat key={i} {...s} />
      ))}
    </div>
  );
}

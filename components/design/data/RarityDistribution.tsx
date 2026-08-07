import type { CSSProperties } from "react";

export interface RarityBucket {
  label: string;
  count: number;
}

export interface RarityDistributionProps {
  buckets: RarityBucket[];
  highlight?: number;
  height?: number;
  style?: CSSProperties;
}

export function RarityDistribution({ buckets = [], highlight, height = 96, style }: RarityDistributionProps) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div style={style}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height }}>
        {buckets.map((b, i) => (
          <div
            key={i}
            title={`${b.label} · ${b.count}`}
            style={{
              flex: 1,
              height: `${Math.max((b.count / max) * 100, 3)}%`,
              background: highlight === i ? "var(--accent)" : "var(--surface-3)",
              borderRadius: "2px 2px 0 0",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "var(--space-4)", fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
        <span>rarest</span>
        <span>most common</span>
      </div>
    </div>
  );
}

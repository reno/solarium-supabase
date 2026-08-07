import type { CSSProperties } from "react";

export interface FloorChartProps {
  data: number[];
  height?: number;
  tone?: "up" | "down";
  volume?: number[];
  ranges?: string[];
  range?: string;
  onRange?: (range: string) => void;
  style?: CSSProperties;
}

export function FloorChart({
  data = [],
  height = 200,
  tone = "up",
  volume,
  ranges = ["1h", "24h", "7d", "30d", "All"],
  range = "7d",
  onRange,
  style,
}: FloorChartProps) {
  const w = 100;
  const h = 100;
  const min = Math.min(...data, 0);
  const max = Math.max(...data, 1);
  const span = max - min || 1;
  const pts = data.map((v, i): [number, number] => [
    (i / (data.length - 1 || 1)) * w,
    h - ((v - min) / span) * h,
  ]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
  const color = tone === "down" ? "var(--price-down)" : "var(--accent)";
  return (
    <div style={style}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-6)" }}>
        <span
          className="sol-label"
          style={{ font: "var(--type-label)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", color: "var(--text-tertiary)" }}
        >
          Floor history
        </span>
        <div style={{ display: "flex", gap: 2 }}>
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => onRange?.(r)}
              style={{
                padding: "3px 8px",
                borderRadius: "var(--radius-xs)",
                border: "none",
                cursor: "pointer",
                background: r === range ? "var(--surface-3)" : "transparent",
                color: r === range ? "var(--text-primary)" : "var(--text-tertiary)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-2xs)",
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div style={{ position: "relative", height }}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
          {[0, 25, 50, 75, 100].map((y) => (
            <line key={y} x1="0" x2={w} y1={y} y2={y} stroke="var(--border-subtle)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
          ))}
          {volume
            ? volume.map((v, i) => {
                const vmax = Math.max(...volume) || 1;
                const bw = w / volume.length;
                const bh = (v / vmax) * 28;
                return <rect key={i} x={i * bw + bw * 0.15} width={bw * 0.7} y={h - bh} height={bh} fill="var(--accent-2)" opacity="0.22" />;
              })
            : null}
          {data.length ? <path d={`${line} L${w},${h} L0,${h} Z`} fill={color} opacity="0.13" /> : null}
          {data.length ? <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /> : null}
        </svg>
      </div>
    </div>
  );
}

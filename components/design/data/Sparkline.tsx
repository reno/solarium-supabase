import type { CSSProperties } from "react";

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** up = green, down = red, neutral = grey. */
  tone?: "up" | "down" | "neutral";
  /** 14%-alpha area fill under the line. */
  area?: boolean;
  style?: CSSProperties;
}

export function Sparkline({ data = [], width = 88, height = 26, tone = "up", area = true, style }: SparklineProps) {
  if (!data.length) return <span style={{ display: "inline-block", width, height, ...style }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i): [number, number] => [
    (i / (data.length - 1 || 1)) * (width - 2) + 1,
    height - 2 - ((v - min) / span) * (height - 4),
  ]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const color = tone === "down" ? "var(--price-down)" : tone === "neutral" ? "var(--text-tertiary)" : "var(--price-up)";
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible", ...style }}>
      {area ? <path d={`${line} L${width - 1},${height} L1,${height} Z`} fill={color} opacity="0.14" /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

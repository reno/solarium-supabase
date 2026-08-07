import type { CSSProperties } from "react";

export interface DepthLevel {
  price: number;
  size: number;
}

export interface DepthChartProps {
  bids: DepthLevel[];
  asks: DepthLevel[];
  height?: number;
  style?: CSSProperties;
}

export function DepthChart({ bids = [], asks = [], height = 160, style }: DepthChartProps) {
  const cum = (arr: DepthLevel[]) => {
    let t = 0;
    return arr.map((d) => ({ ...d, cum: (t += d.size) }));
  };
  const b = cum(bids);
  const a = cum(asks);
  const maxCum = Math.max(...b.map((d) => d.cum), ...a.map((d) => d.cum), 1);
  const poly = (arr: { cum: number }[], flip: boolean) => {
    const n = arr.length || 1;
    const pts = arr.map((d, i): [number, number] => {
      const x = (i / (n - 1 || 1)) * 50;
      return [flip ? 50 - x : 50 + x, 100 - (d.cum / maxCum) * 100];
    });
    if (!pts.length) return "";
    return (
      `M${pts[0][0]},100 ` +
      pts.map((p) => `L${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ") +
      ` L${pts[pts.length - 1][0]},100 Z`
    );
  };
  return (
    <div style={style}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--space-5)" }}>
        <span style={{ font: "var(--type-label)", fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", color: "var(--price-up)" }}>Bids</span>
        <span style={{ font: "var(--type-label)", fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", color: "var(--price-down)" }}>Asks</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
        <path d={poly(b, true)} fill="var(--price-up)" opacity="0.18" />
        <path d={poly(b, true)} fill="none" stroke="var(--price-up)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path d={poly(a, false)} fill="var(--price-down)" opacity="0.18" />
        <path d={poly(a, false)} fill="none" stroke="var(--price-down)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <line x1="50" x2="50" y1="0" y2="100" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

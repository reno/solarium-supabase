import type { CSSProperties } from "react";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: string;
  style?: CSSProperties;
}

export function Skeleton({ width = "100%", height = 12, radius = "var(--radius-xs)", style }: SkeletonProps) {
  return (
    <span
      style={{
        display: "block",
        width,
        height,
        borderRadius: radius,
        background: "linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%)",
        backgroundSize: "200% 100%",
        animation: "sol-shimmer 1.2s linear infinite",
        ...style,
      }}
    />
  );
}

import type { CSSProperties, ReactNode } from "react";

export interface ArtTileProps {
  src?: string;
  label?: string;
  ratio?: string;
  radius?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function ArtTile({ src, label = "nft art", ratio = "1 / 1", radius = "var(--radius-media)", style, children }: ArtTileProps) {
  return (
    <div
      style={{
        position: "relative",
        aspectRatio: ratio,
        width: "100%",
        borderRadius: radius,
        overflow: "hidden",
        background: src ? "var(--surface-inset)" : undefined,
        backgroundImage: src
          ? `url(${src})`
          : "repeating-linear-gradient(135deg, var(--surface-2) 0 6px, var(--surface-inset) 6px 12px)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {!src ? (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", letterSpacing: "0.04em" }}>
          {label}
        </span>
      ) : null}
      {children}
    </div>
  );
}

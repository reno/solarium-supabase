import type { CSSProperties, ReactNode } from "react";

export interface ArtTileProps {
  src?: string;
  label?: string;
  ratio?: string;
  radius?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

// `url(...)` unquoted ends at the first `)`, so an image URL containing one used to break the
// declaration and the browser would drop the whole background — a blank tile, on every card in
// the app. Quoting it and escaping the quote characters makes the value opaque to the parser.
function cssUrl(src: string): string {
  return `url("${src.replace(/["\\]/g, "\\$&")}")`;
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
          ? cssUrl(src)
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

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

export interface ArtTileProps {
  src?: string;
  label?: string;
  alt?: string;
  ratio?: string;
  radius?: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function ArtTile({
  src,
  label = "nft art",
  alt,
  ratio = "1 / 1",
  radius = "var(--radius-media)",
  sizes = "(max-width: 767px) 50vw, 400px",
  priority,
  className,
  style,
  children,
}: ArtTileProps) {
  return (
    <div
      className={className}
      style={{
        position: "relative",
        aspectRatio: ratio,
        width: "100%",
        borderRadius: radius,
        overflow: "hidden",
        background: src ? "var(--surface-inset)" : undefined,
        backgroundImage: src
          ? undefined
          : "repeating-linear-gradient(135deg, var(--surface-2) 0 6px, var(--surface-inset) 6px 12px)",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {src ? (
        <Image
          src={src}
          alt={alt ?? label}
          fill
          unoptimized
          sizes={sizes}
          priority={priority}
          style={{ objectFit: "cover" }}
        />
      ) : (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", letterSpacing: "0.04em" }}>
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

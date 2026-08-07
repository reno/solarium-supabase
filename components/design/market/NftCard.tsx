"use client";

import { useState, type CSSProperties, type MouseEvent } from "react";

import { Icon } from "../core/Icon";
import { ArtTile } from "./ArtTile";
import { RarityBadge } from "./RarityBadge";

export interface NftCardProps {
  name: string;
  collection?: string;
  price: string | number;
  currency?: string;
  fiat?: string;
  rank?: number | string;
  total?: number | string;
  src?: string;
  selected?: boolean;
  lastSale?: string;
  onBuy?: () => void;
  onSelect?: () => void;
  style?: CSSProperties;
}

export function NftCard({
  name,
  collection,
  price,
  currency = "SOL",
  fiat,
  rank,
  total,
  src,
  selected,
  lastSale,
  onBuy,
  onSelect,
  style,
}: NftCardProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
      style={{
        position: "relative",
        background: "var(--surface-card)",
        border: `1px solid ${selected ? "var(--accent)" : hover ? "var(--border-strong)" : "var(--border-subtle)"}`,
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color var(--dur-fast) var(--ease-out)",
        ...style,
      }}
    >
      <div style={{ padding: "var(--space-4)", paddingBottom: 0, position: "relative" }}>
        <ArtTile src={src} label={name || "nft art"} />
        {rank != null ? (
          <div style={{ position: "absolute", top: "var(--space-6)", left: "var(--space-6)" }}>
            <RarityBadge rank={rank} total={total} />
          </div>
        ) : null}
      </div>
      <div style={{ padding: "var(--space-5) var(--space-5) var(--space-6)", position: "relative" }}>
        {collection ? (
          <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {collection}
          </div>
        ) : null}
        <div style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {name}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: "var(--space-4)" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
            {price}
            <span style={{ fontSize: "0.78em", marginLeft: 3, color: "var(--text-secondary)" }}>{currency}</span>
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
            {fiat || (lastSale ? `last ${lastSale}` : "")}
          </span>
        </div>
        {onBuy && (
        <button
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            onBuy();
          }}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 34,
            background: "var(--accent)",
            color: "var(--text-on-accent)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-3)",
            fontFamily: "var(--font-sans)",
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-bold)",
            cursor: "pointer",
            transform: hover ? "translateY(0)" : "translateY(100%)",
            transition: "transform var(--dur-fast) var(--ease-out)",
          }}
        >
          <Icon name="zap" size={13} /> Buy now
        </button>
        )}
      </div>
    </div>
  );
}

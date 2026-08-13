"use client";

import { useState, type CSSProperties } from "react";

import { Icon } from "../core/Icon";
import { ArtTile } from "./ArtTile";

const KIND: Record<string, { icon: string; color: string; label: string }> = {
  sale: { icon: "arrow-left-right", color: "var(--text-secondary)", label: "Sale" },
  list: { icon: "tag", color: "var(--text-secondary)", label: "List" },
  bid: { icon: "gavel", color: "var(--accent-2)", label: "Bid" },
  mint: { icon: "sparkle", color: "var(--accent)", label: "Mint" },
  transfer: { icon: "arrow-right", color: "var(--text-tertiary)", label: "Transfer" },
  delist: { icon: "x", color: "var(--text-tertiary)", label: "Delist" },
};

export interface ActivityRowProps {
  kind?: "sale" | "list" | "bid" | "mint" | "transfer" | "delist";
  item: string;
  image?: string;
  collection?: string;
  price: string;
  currency?: string;
  from?: string;
  to?: string;
  time?: string;
  compact?: boolean;
  flash?: "up" | "down";
  style?: CSSProperties;
}

export function ActivityRow({ kind = "sale", item, image, collection, price, currency = "SOL", from, to, time, flash, compact, style }: ActivityRowProps) {
  const [hover, setHover] = useState(false);
  const k = KIND[kind] || KIND.sale;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={compact ? "sol-row sol-row-activity-compact" : "sol-row sol-row-activity"}
      style={{
        display: "grid",
        gridTemplateColumns: compact ? "72px 1fr 92px 48px" : "88px 1fr 110px 96px 96px 56px",
        alignItems: "center",
        gap: "var(--space-6)",
        height: 44,
        padding: "0 var(--space-7)",
        borderBottom: "1px solid var(--border-subtle)",
        background: hover ? "var(--surface-hover)" : "transparent",
        animation: flash ? (`sol-flash-${flash} 400ms var(--ease-out)` as CSSProperties["animation"]) : undefined,
        transition: "background-color var(--dur-fast) var(--ease-out)",
        ...style,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-3)", color: k.color, fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)" }}>
        <Icon name={k.icon} size={13} /> {k.label}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", minWidth: 0 }}>
        <ArtTile src={image} label="" style={{ width: 26, height: 26, flex: "0 0 auto" }} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: "var(--text-md)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {item}
          </span>
          {collection ? <span style={{ display: "block", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>{collection}</span> : null}
        </span>
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-md)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>
        {price}
        <span style={{ fontSize: "0.78em", marginLeft: 3, color: "var(--text-secondary)" }}>{currency}</span>
      </span>
      {compact ? null : <span className="sol-hide-sm" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{from}</span>}
      {compact ? null : <span className="sol-hide-sm" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{to}</span>}
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textAlign: "right" }}>{time}</span>
    </div>
  );
}

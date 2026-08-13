"use client";

import { useState, type CSSProperties } from "react";

import { Icon } from "../core/Icon";
import { Sparkline } from "../data/Sparkline";
import { ArtTile } from "./ArtTile";

export interface TrendingRowProps {
  rank: number | string;
  name: string;
  verified?: boolean;
  image?: string;
  floor: string;
  delta?: string;
  volume?: string;
  listed?: string;
  owners?: string;
  series?: number[];
  onClick?: () => void;
  style?: CSSProperties;
}

export function TrendingRow({ rank, name, verified, image, floor, delta, volume, listed, owners, series, onClick, style }: TrendingRowProps) {
  const [hover, setHover] = useState(false);
  const signed = delta?.trim().startsWith("+") || delta?.trim().startsWith("−");
  const tone = !signed ? "neutral" : delta!.trim().startsWith("−") ? "down" : "up";
  const deltaColor = tone === "down" ? "var(--price-down)" : tone === "up" ? "var(--price-up)" : "var(--text-tertiary)";
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="sol-row sol-row-trending"
      style={{
        display: "grid",
        gridTemplateColumns: "34px 1fr 96px 74px 104px 74px 78px 92px",
        alignItems: "center",
        gap: "var(--space-6)",
        height: 56,
        padding: "0 var(--space-7)",
        borderBottom: "1px solid var(--border-subtle)",
        cursor: "pointer",
        background: hover ? "var(--surface-hover)" : "transparent",
        transition: "background-color var(--dur-fast) var(--ease-out)",
        ...style,
      }}
    >
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{rank}</span>
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", minWidth: 0 }}>
        <ArtTile src={image} label="" style={{ width: 34, height: 34, flex: "0 0 auto" }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
          <span style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {name}
          </span>
          {verified ? <Icon name="badge-check" size={14} color="var(--accent-2)" /> : null}
        </span>
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-md)", fontWeight: "var(--weight-medium)", color: "var(--text-primary)" }}>
        {floor}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: deltaColor }}>{delta}</span>
      <span className="sol-hide-sm" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-md)", color: "var(--text-body)" }}>{volume}</span>
      <span className="sol-hide-sm" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>{listed}</span>
      <span className="sol-hide-sm" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>{owners}</span>
      <span className="sol-hide-sm" style={{ display: "flex", alignItems: "center" }}>
        {series?.length ? (
          <Sparkline data={series} tone={tone} width={88} height={26} />
        ) : (
          <span
            title="No trades yet"
            style={{ display: "flex", alignItems: "center", width: 88, height: 26, fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}
          >
            no trades
          </span>
        )}
      </span>
    </div>
  );
}

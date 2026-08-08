"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ArtTile, Badge, Button, Card } from "@/components/design";

export type FeaturedItem = {
  nftId: string;
  itemName: string;
  imageUrl: string | null;
  collectionName: string;
  priceSol: string;
  listedCount: number;
  totalCount: number;
};

const ADVANCE_MS = 4500;

export function FeaturedCarousel({ items }: { items: FeaturedItem[] }) {
  const [index, setIndex] = useState(0);
  const count = items.length;

  useEffect(() => {
    if (count < 2) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % count), ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [index, count]);

  if (count === 0) return null;
  const position = index % count;
  const item = items[position];
  const availability = item.totalCount > 0 ? (item.listedCount / item.totalCount) * 100 : 0;

  return (
    <Card padding="var(--space-6)">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-6)" }}>
        <span className="sol-label">Recently listed</span>
        <Badge tone="live" dot>Live</Badge>
      </div>

      <div>
        <Link href={`/nft/${item.nftId}`} style={{ display: "block", textDecoration: "none" }}>
          <ArtTile src={item.imageUrl ?? undefined} label={item.itemName} ratio="16 / 7" />
        </Link>

        {count > 1 && (
          <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-4)", marginTop: "var(--space-5)" }}>
            {items.map((slide, i) => (
              <Dot key={slide.nftId} active={i === position} onClick={() => setIndex(i)} label={slide.collectionName} />
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: "var(--space-6)", gap: "var(--space-5)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {item.collectionName}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {item.priceSol} SOL · {item.listedCount} / {item.totalCount} listed
          </div>
        </div>
        <Link href={`/nft/${item.nftId}`} style={{ textDecoration: "none", flex: "0 0 auto" }}>
          <Button variant="primary" size="sm">Buy</Button>
        </Link>
      </div>

      <div
        title={`${item.listedCount} of ${item.totalCount} items listed`}
        style={{ height: 4, background: "var(--surface-3)", borderRadius: 999, marginTop: "var(--space-6)", overflow: "hidden" }}
      >
        <div
          style={{
            width: `${availability}%`,
            height: "100%",
            background: "var(--accent)",
            transition: "width var(--dur-base) var(--ease-out)",
          }}
        />
      </div>
    </Card>
  );
}

function Dot({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Show ${label}`}
      aria-current={active}
      style={{
        width: 6,
        height: 6,
        padding: 0,
        border: "none",
        borderRadius: "var(--radius-pill)",
        background: active ? "var(--gray-10)" : "var(--gray-5)",
        cursor: "pointer",
        transition: "background-color var(--dur-fast) var(--ease-out)",
      }}
    />
  );
}

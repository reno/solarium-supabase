"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ArtTile, Badge, Button, Card } from "@/components/design";

export type FeaturedItem = {
  /** The recently listed item — what the art and the Buy button point at. */
  nftId: string;
  itemName: string;
  imageUrl: string | null;
  /** Headline: the collection this listing belongs to (its own name for a standalone 1/1). */
  collectionName: string;
  priceSol: string;
  /** Availability across the collection, drawn by the bar along the bottom. */
  listedCount: number;
  totalCount: number;
};

const ADVANCE_MS = 4500;

/**
 * The Explore hero card, cycling through collections with a recent listing (one slide each).
 *
 * Same card composition as the featured drop it replaces — label + badge, 16:7 media, a title
 * block with a call to action, and a bar along the bottom showing how much of the collection is
 * available. Navigation is the dot row under the media; there are no arrows over the art, and it
 * keeps advancing whether or not the pointer is over it.
 */
export function FeaturedCarousel({ items }: { items: FeaturedItem[] }) {
  const [index, setIndex] = useState(0);
  const count = items.length;

  // Advances unconditionally — no pause-on-hover, since the cursor tends to sit over this card
  // and a paused carousel is indistinguishable from a broken one. Keying off `index` reschedules
  // on every change, so picking a dot buys a full interval before the next automatic step.
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

/** One slide marker: a small white dot, dimmed until it's the current slide. */
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

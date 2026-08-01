"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { BuyButton } from "@/components/listings/buy-button";
import { OwnedNftControls } from "@/components/listings/my-nft-card";
import { lamportsToSol } from "@/lib/solana/lamports";

function shortWallet(address: string | null | undefined): string {
  if (!address) return "unknown";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export type SeriesEdition = {
  id: string;
  name: string;
  imageUrl: string;
  assetAddress: string;
  editionNumber: number | null;
  editionTotal: number | null;
  collectionId: string;
  collectionAddress: string | null;
  listing: { id: string; priceLamports: string; sellerId: string } | null;
  owner: { username: string | null; walletAddress: string | null } | null;
  isOwnedByViewer: boolean;
};

export function SeriesCarousel({
  editions,
  viewerId,
}: {
  editions: SeriesEdition[];
  viewerId: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  // Track the most-visible slide as the user scrolls/swipes, rather than
  // only reacting to snap "settle" — keeps the dots/arrows live mid-drag.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ratios = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) ratios.set(entry.target, entry.intersectionRatio);
        let bestIndex = 0;
        let bestRatio = -1;
        slideRefs.current.forEach((el, i) => {
          const ratio = el ? (ratios.get(el) ?? 0) : 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestIndex = i;
          }
        });
        setActiveIndex(bestIndex);
      },
      { root: container, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    slideRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [editions.length]);

  const scrollToIndex = (index: number) => {
    const clamped = Math.max(0, Math.min(editions.length - 1, index));
    slideRefs.current[clamped]?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  };

  return (
    <div>
      <div
        ref={containerRef}
        className="flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-px-6 px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {editions.map((edition, i) => (
          <div
            key={edition.id}
            ref={(el) => {
              slideRefs.current[i] = el;
            }}
            // Slide width also caps by viewport height so the full card
            // (square image + ~140px body) plus ~360px of page chrome fits
            // 100vh without page scroll; the 280px floor keeps cards usable
            // on very short screens (accepting slight scroll there).
            className="w-[85%] max-w-[max(280px,calc(100vh-500px))] shrink-0 snap-center overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 sm:w-[60%] lg:w-[45%]"
          >
            <Link href={`/nft/${edition.id}`} className="block">
              <div className="relative aspect-square bg-zinc-100 dark:bg-zinc-900">
                <Image
                  src={edition.imageUrl}
                  alt={edition.name}
                  fill
                  sizes="(min-width: 1024px) 45vw, (min-width: 640px) 60vw, 85vw"
                  className="object-cover"
                  unoptimized
                />
              </div>
            </Link>
            <div className="p-4">
              <Link href={`/nft/${edition.id}`}>
                <h2 className="font-medium">{edition.name}</h2>
              </Link>
              {edition.editionTotal ? (
                <p className="mt-0.5 text-sm text-zinc-500">
                  #{edition.editionNumber}/{edition.editionTotal}
                </p>
              ) : null}
              <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                {edition.isOwnedByViewer ? (
                  <OwnedNftControls
                    nft={{
                      id: edition.id,
                      name: edition.name,
                      imageUrl: edition.imageUrl,
                      assetAddress: edition.assetAddress,
                      editionNumber: edition.editionNumber,
                      editionTotal: edition.editionTotal,
                      collectionId: edition.collectionId,
                      collectionAddress: edition.collectionAddress,
                      listing: edition.listing
                        ? {
                            id: edition.listing.id,
                            priceLamports: edition.listing.priceLamports,
                          }
                        : null,
                    }}
                    userId={viewerId!}
                  />
                ) : edition.listing ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-lg font-medium">
                      {lamportsToSol(BigInt(edition.listing.priceLamports))} SOL
                    </p>
                    <BuyButton
                      listingId={edition.listing.id}
                      sellerId={edition.listing.sellerId}
                      priceSol={lamportsToSol(BigInt(edition.listing.priceLamports))}
                      viewerId={viewerId}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">
                    {edition.owner
                      ? `Owned by @${edition.owner.username ?? shortWallet(edition.owner.walletAddress)}`
                      : "Not for sale"}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2">
        {editions.map((edition, i) => (
          <button
            key={edition.id}
            type="button"
            aria-label={`Go to edition ${i + 1}`}
            onClick={() => scrollToIndex(i)}
            className={`h-2 rounded-full transition-all ${
              i === activeIndex
                ? "w-6 bg-zinc-900 dark:bg-zinc-50"
                : "w-2 bg-zinc-300 dark:bg-zinc-700"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

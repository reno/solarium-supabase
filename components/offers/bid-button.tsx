"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { BidDialog, Button } from "@/components/design";
import { useToast } from "@/components/toast/toast-provider";
import { createOffer } from "@/lib/offers/offers";
import { solToLamports } from "@/lib/solana/lamports";
import { createClient } from "@/lib/supabase/client";

export function BidButton({
  nftId,
  itemName,
  collectionName,
  viewerId,
  isOwner,
  floorSol,
  topBidSol,
  block,
}: {
  nftId: string;
  itemName: string;
  collectionName?: string;
  viewerId: string | null;
  isOwner?: boolean;
  floorSol?: string;
  topBidSol?: string;
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();

  if (!viewerId) return null;
  if (isOwner) {
    return (
      <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>You own this item</p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <Button variant="bid" icon="gavel" block={block} onClick={() => { setError(null); setOpen(true); }}>
        Place bid
      </Button>
      {error && <span style={{ fontSize: "var(--text-xs)", color: "var(--price-down)" }}>{error}</span>}
      <BidDialog
        open={open}
        onClose={() => setOpen(false)}
        item={itemName}
        collection={collectionName}
        floor={floorSol}
        topBid={topBidSol}
        onConfirm={async (amount, expiresInHours) => {
          setError(null);
          let lamports: bigint;
          try {
            lamports = solToLamports(amount);
          } catch {
            setError("Enter a valid SOL amount, e.g. 0.5 (up to 9 decimals).");
            setOpen(false);
            return;
          }
          try {
            await createOffer(supabase, { nftId, bidderId: viewerId, priceLamports: lamports, expiresInHours });
            setOpen(false);
            showToast({ type: "success", title: "Offer placed", message: `${itemName} · ${amount} SOL` });
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to place offer.");
            setOpen(false);
          }
        }}
      />
    </div>
  );
}

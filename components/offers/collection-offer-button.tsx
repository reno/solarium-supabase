"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, Dialog, IconButton, Input, Select } from "@/components/design";
import { useToast } from "@/components/toast/toast-provider";
import { createCollectionOffer } from "@/lib/offers/offers";
import { solToLamports } from "@/lib/solana/lamports";
import { createClient } from "@/lib/supabase/client";

const EXPIRY: Record<string, number> = { "24h": 24, "7d": 168, "30d": 720 };

export function CollectionOfferButton({
  collectionId,
  collectionName,
  viewerId,
  floorSol,
}: {
  collectionId: string;
  collectionName: string;
  viewerId: string | null;
  floorSol?: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [qty, setQty] = useState(1);
  const [expiry, setExpiry] = useState("7d");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!viewerId) return null;

  const belowNote = floorSol && amount && parseFloat(amount) < parseFloat(floorSol) ? `${(((parseFloat(floorSol) - parseFloat(amount)) / parseFloat(floorSol)) * 100).toFixed(0)}% below floor` : null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const priceLamports = solToLamports(amount);
      await createCollectionOffer(supabase, { collectionId, bidderId: viewerId, priceLamports, quantity: qty, expiresInHours: EXPIRY[expiry] });
      showToast({ type: "success", title: "Collection offer placed", message: `${amount} SOL · any ${qty} item${qty === 1 ? "" : "s"}` });
      setOpen(false);
      setAmount("");
      setQty(1);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to place offer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="bid" icon="gavel" onClick={() => setOpen(true)}>
        Collection offer
      </Button>
      <Dialog
        open={open}
        onClose={busy ? undefined : () => setOpen(false)}
        title={`Offer on ${collectionName}`}
        footer={
          <>
            <Button variant="ghost" block disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="bid" block loading={busy} disabled={busy || !amount.trim()} onClick={submit}>Place bid</Button>
          </>
        }
      >
        <p style={{ margin: "0 0 var(--space-6)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
          Bid on <strong style={{ color: "var(--text-primary)" }}>any</strong> item in the collection. Any holder can
          accept it against one of their items. Offers lock no funds — you sign and pay only if accepted.
        </p>
        <label style={{ display: "block", font: "var(--type-label)", fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", color: "var(--text-tertiary)", marginBottom: "var(--space-4)" }}>
          Price per item
        </label>
        <div style={{ display: "flex", gap: "var(--space-5)" }}>
          <Input numeric suffix="SOL" inputMode="decimal" placeholder={floorSol ?? "0.0"} value={amount} onChange={(e) => setAmount(e.target.value)} containerStyle={{ flex: 1 }} />
          <Select options={Object.keys(EXPIRY)} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
        {belowNote ? <p style={{ margin: "var(--space-4) 0 0", fontSize: "var(--text-2xs)", color: "var(--price-down)" }}>{belowNote}</p> : null}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "var(--space-7)" }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Quantity (any items)</span>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
            <IconButton icon="minus" label="Decrease" size="sm" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))} />
            <span style={{ minWidth: 24, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>{qty}</span>
            <IconButton icon="plus" label="Increase" size="sm" onClick={() => setQty((q) => q + 1)} />
          </div>
        </div>
        {error ? <p style={{ margin: "var(--space-5) 0 0", fontSize: "var(--text-xs)", color: "var(--price-down)" }}>{error}</p> : null}
      </Dialog>
    </>
  );
}

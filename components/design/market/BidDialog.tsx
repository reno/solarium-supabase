"use client";

import { useState } from "react";

import { Dialog } from "../core/Dialog";
import { Button } from "../core/Button";
import { Input } from "../core/Input";
import { Select } from "../core/Select";
import { ArtTile } from "./ArtTile";

export interface BidDialogProps {
  open: boolean;
  onClose?: () => void;
  item: string;
  collection?: string;
  /** Current floor, used for the below-floor warning. */
  floor?: string;
  topBid?: string;
  balance?: string;
  onConfirm?: (amount: string, expiresInHours: number) => void;
}

const EXPIRIES: { label: string; hours: number }[] = [
  { label: "Expires in 24h", hours: 24 },
  { label: "Expires in 7d", hours: 168 },
  { label: "Expires in 30d", hours: 720 },
];

export function BidDialog({ open, onClose, item, collection, floor, topBid, balance, onConfirm }: BidDialogProps) {
  const [amount, setAmount] = useState("");
  const [expiry, setExpiry] = useState(EXPIRIES[0].label);
  const below = !!amount && !!floor && parseFloat(amount) < parseFloat(floor);
  const expiryHours = EXPIRIES.find((e) => e.label === expiry)?.hours ?? 24;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Place bid"
      width={420}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} style={{ flex: 1 }}>
            Cancel
          </Button>
          <Button variant="bid" onClick={() => onConfirm?.(amount, expiryHours)} disabled={!amount} style={{ flex: 2 }}>
            Place bid
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", gap: "var(--space-7)", alignItems: "center", marginBottom: "var(--space-7)" }}>
        <ArtTile label="" style={{ width: 64, height: 64, flex: "0 0 auto" }} />
        <div>
          <div style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>{collection}</div>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>{item}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--space-9)", marginBottom: "var(--space-7)" }}>
        {([["Floor", floor], ["Top bid", topBid]] as const).map(([l, v]) =>
          v ? (
            <div key={l}>
              <div style={{ font: "var(--type-label)", fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", color: "var(--text-tertiary)" }}>
                {l}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>{v} SOL</div>
            </div>
          ) : null
        )}
      </div>
      <label style={{ display: "block", font: "var(--type-label)", fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", color: "var(--text-tertiary)", marginBottom: "var(--space-4)" }}>
        Bid amount
      </label>
      <Input numeric suffix="SOL" placeholder="0.00" size="lg" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!below} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "var(--space-5)" }}>
        <Select size="sm" options={EXPIRIES.map((e) => e.label)} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Balance {balance} SOL</span>
      </div>
      {below ? (
        <div style={{ marginTop: "var(--space-5)", fontSize: "var(--text-xs)", color: "var(--price-down)" }}>Bid is below floor. It may not be accepted.</div>
      ) : null}
      <div style={{ marginTop: "var(--space-5)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)", textWrap: "pretty" }}>
        Offers lock no funds. If the seller accepts, you sign and pay then — you can cancel any time before that.
      </div>
    </Dialog>
  );
}

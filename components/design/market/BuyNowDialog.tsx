import { FEE_LABEL } from "@/supabase/functions/_shared/fee";

import { Dialog } from "../core/Dialog";
import { Button } from "../core/Button";
import { ArtTile } from "./ArtTile";

export interface BuyNowDialogProps {
  open: boolean;
  onClose?: () => void;
  item: string;
  collection?: string;
  price: string;
  fee?: string;
  royalty?: string;
  total?: string;
  fiat?: string;
  balance?: string;
  onConfirm?: () => void;
}

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "down" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-4) 0" }}>
      <span style={{ fontSize: "var(--text-md)", color: strong ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: strong ? "var(--weight-semibold)" : undefined }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
          fontSize: strong ? "var(--text-lg)" : "var(--text-md)",
          fontWeight: strong ? "var(--weight-semibold)" : "var(--weight-medium)",
          color: tone === "down" ? "var(--price-down)" : "var(--text-primary)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function BuyNowDialog({ open, onClose, item, collection, price, fee = FEE_LABEL, royalty = "5.0%", total, fiat, balance, onConfirm }: BuyNowDialogProps) {
  const insufficient = balance != null && parseFloat(balance) < parseFloat(total ?? price);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Complete purchase"
      width={420}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} style={{ flex: 1 }}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={insufficient} style={{ flex: 2 }}>
            {insufficient ? "Insufficient SOL" : "Confirm purchase"}
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
      <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <Line label="Price" value={`${price} SOL`} />
        <Line label={`Marketplace fee · ${fee}`} value={`${((parseFloat(price) * parseFloat(fee)) / 100).toFixed(3)} SOL`} />
        <Line label={`Creator royalty · ${royalty}`} value={`${((parseFloat(price) * parseFloat(royalty)) / 100).toFixed(3)} SOL`} />
      </div>
      <div style={{ borderTop: "1px solid var(--border-default)", marginTop: "var(--space-4)" }}>
        <Line label="Total" value={`${total ?? price} SOL`} strong />
        {fiat ? (
          <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: -6 }}>
            {fiat}
          </div>
        ) : null}
      </div>
      {balance != null ? (
        <div style={{ marginTop: "var(--space-6)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: insufficient ? "var(--price-down)" : "var(--text-tertiary)" }}>
          Balance {balance} SOL
        </div>
      ) : null}
    </Dialog>
  );
}

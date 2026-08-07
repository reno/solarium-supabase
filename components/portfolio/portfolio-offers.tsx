"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Card, Icon } from "@/components/design";
import { useToast } from "@/components/toast/toast-provider";
import { cancelOffer } from "@/lib/offers/offers";
import { createClient } from "@/lib/supabase/client";

const LABEL: React.CSSProperties = {
  font: "var(--type-label)",
  fontSize: "var(--text-2xs)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-label)",
  color: "var(--text-tertiary)",
};

export type PortfolioOffer = { id: string; item: string; offerSol: string; expiresLabel: string };

/** The Portfolio "Offers" tab: the viewer's open bids, each with a working Cancel. */
export function PortfolioOffers({ offers, bidderId }: { offers: PortfolioOffer[]; bidderId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancel = async (o: PortfolioOffer) => {
    setBusyId(o.id);
    setError(null);
    try {
      await cancelOffer(supabase, { offerId: o.id, bidderId });
      showToast({ type: "success", title: "Offer withdrawn", message: `${o.item} · ${o.offerSol} SOL` });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the offer.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card padding={0}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 110px 90px", gap: "var(--space-6)", padding: "var(--space-6) var(--space-7)", borderBottom: "1px solid var(--border-subtle)" }}>
        {["Item", "Your offer", "Expires", ""].map((h, i) => <span key={i} style={LABEL}>{h}</span>)}
      </div>
      {offers.map((o, i) => {
        const busy = busyId === o.id;
        return (
          <div key={o.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 110px 90px", gap: "var(--space-6)", alignItems: "center", height: 48, padding: "0 var(--space-7)", borderBottom: i === offers.length - 1 ? "none" : "1px solid var(--border-subtle)" }}>
            <span style={{ fontSize: "var(--text-md)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.item}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--accent-2)" }}>{o.offerSol} SOL</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{o.expiresLabel}</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => cancel(o)}
              style={{
                justifySelf: "end",
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-3)",
                height: 28,
                padding: "0 var(--space-4)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-control)",
                background: "var(--surface-2)",
                color: "var(--text-secondary)",
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-medium)",
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.5 : 1,
              }}
            >
              <Icon name={busy ? "loader-circle" : "x"} size={12} />
              Cancel
            </button>
          </div>
        );
      })}
      {error && <p style={{ margin: 0, padding: "var(--space-4) var(--space-7)", fontSize: "var(--text-xs)", color: "var(--price-down)" }}>{error}</p>}
    </Card>
  );
}

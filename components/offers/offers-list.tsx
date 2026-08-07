"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge, Button, Dialog } from "@/components/design";
import { useToast } from "@/components/toast/toast-provider";
import { CompleteOfferButton } from "@/components/offers/complete-offer-button";
import { acceptOffer } from "@/lib/offers/accept";
import { cancelOffer } from "@/lib/offers/offers";
import type { OfferEntry } from "@/lib/offers/map";
import { createClient } from "@/lib/supabase/client";

export type { OfferEntry };

function untilLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  if (ms < 3_600_000) return `in ${Math.ceil(ms / 60_000)}m`;
  if (ms < 86_400_000) return `in ${Math.floor(ms / 3_600_000)}h`;
  return `in ${Math.floor(ms / 86_400_000)}d`;
}

function deltaVsList(offerSol: string, listSol: string | null | undefined): string | null {
  if (!listSol) return null;
  const offer = parseFloat(offerSol);
  const list = parseFloat(listSol);
  if (!(list > 0) || !Number.isFinite(offer)) return null;
  const pct = Math.round(Math.abs((offer - list) / list) * 100);
  if (pct === 0) return "at list price";
  return `${pct}% ${offer < list ? "below" : "above"} list`;
}

type Confirm = { kind: "accept" | "withdraw"; offer: OfferEntry };

function Line({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "var(--space-3) 0" }}>
      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-md)", color: accent ? "var(--accent)" : "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

export function OffersList({
  offers,
  viewerId,
  isOwner,
  listPriceSol,
  nftId,
}: {
  offers: OfferEntry[];
  viewerId: string | null;
  isOwner: boolean;
  listPriceSol?: string | null;
  nftId: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  if (offers.length === 0) {
    return (
      <p style={{ margin: 0, padding: "var(--space-7)", fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
        No offers yet.
      </p>
    );
  }

  const run = async (id: string, fn: () => Promise<unknown>, toast?: { title: string; message: string }) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      if (toast) showToast({ type: "success", ...toast });
      setConfirm(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  };

  const busyConfirm = confirm ? busyId === confirm.offer.id : false;

  return (
    <div>
      {offers.map((o, i) => {
        const mine = o.bidderId === viewerId;
        const bind = o.bindNftId ?? nftId;
        const canAccept = (o.acceptable ?? isOwner) && (!o.isCollection || bind !== null);
        return (
          <div
            key={o.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 110px 96px 150px",
              alignItems: "center",
              gap: "var(--space-6)",
              minHeight: 48,
              padding: "var(--space-4) var(--space-7)",
              borderBottom: i === offers.length - 1 ? "none" : "1px solid var(--border-subtle)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-4)", fontSize: "var(--text-md)", color: "var(--text-primary)", minWidth: 0 }}>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {mine ? "You" : `@${o.bidderName}`}
                {o.itemName ? <span style={{ color: "var(--text-tertiary)" }}> · {o.itemName}</span> : null}
              </span>
              {o.isCollection ? <Badge tone="cyan">collection{o.quantity && o.quantity > 1 ? ` ×${o.quantity}` : ""}</Badge> : null}
              {o.settled ? (
                <Badge tone="neutral">sold</Badge>
              ) : o.status === "accepted" ? (
                <Badge tone="accent">accepted</Badge>
              ) : null}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-md)", color: "var(--accent-2)" }}>
              {o.priceSol} SOL
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
              {o.status === "accepted" ? "—" : untilLabel(o.expiresAt)}
            </span>
            <span style={{ justifySelf: "end" }}>
              {o.settled ? (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Sold</span>
              ) : mine && o.status === "accepted" ? (
                <CompleteOfferButton offerId={o.id} />
              ) : mine && o.status === "active" ? (
                <Button variant="ghost" size="sm" onClick={() => setConfirm({ kind: "withdraw", offer: o })}>
                  Cancel
                </Button>
              ) : canAccept && o.status === "active" ? (
                <Button variant="primary" size="sm" onClick={() => setConfirm({ kind: "accept", offer: o })}>
                  Accept
                </Button>
              ) : canAccept && o.status === "accepted" ? (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>awaiting buyer</span>
              ) : null}
            </span>
          </div>
        );
      })}
      <Dialog
        open={confirm?.kind === "accept"}
        onClose={busyConfirm ? undefined : () => setConfirm(null)}
        title="Accept offer"
        footer={
          <>
            <Button variant="ghost" block disabled={busyConfirm} onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="primary"
              block
              loading={busyConfirm}
              disabled={busyConfirm}
              onClick={() =>
                confirm &&
                run(confirm.offer.id, () => acceptOffer(supabase, confirm.offer.id, confirm.offer.isCollection ? (confirm.offer.bindNftId ?? nftId) ?? undefined : undefined), {
                  title: "Offer accepted",
                  message: `@${confirm.offer.bidderName} · ${confirm.offer.priceSol} SOL`,
                })
              }
            >
              Accept offer
            </Button>
          </>
        }
      >
        {confirm?.kind === "accept" && (
          <>
            <p style={{ margin: "0 0 var(--space-6)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
              <strong style={{ color: "var(--text-primary)" }}>@{confirm.offer.bidderName}</strong> offered{" "}
              {confirm.offer.priceSol} SOL{deltaVsList(confirm.offer.priceSol, listPriceSol) ? ` (${deltaVsList(confirm.offer.priceSol, listPriceSol)})` : ""}.
              Accepting doesn&apos;t move funds yet — the bidder then signs and pays, and you sign to release the item.
            </p>
            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-3)" }}>
              <Line label="Offer" value={`${confirm.offer.priceSol} SOL`} />
              <Line label="You receive" value={`${confirm.offer.priceSol} SOL`} accent />
            </div>
            {error && <p style={{ margin: "var(--space-5) 0 0", fontSize: "var(--text-xs)", color: "var(--price-down)" }}>{error}</p>}
          </>
        )}
      </Dialog>

      <Dialog
        open={confirm?.kind === "withdraw"}
        onClose={busyConfirm ? undefined : () => setConfirm(null)}
        title="Withdraw offer"
        footer={
          <>
            <Button variant="ghost" block disabled={busyConfirm} onClick={() => setConfirm(null)}>Keep offer</Button>
            <Button
              variant="danger"
              block
              loading={busyConfirm}
              disabled={busyConfirm}
              onClick={() =>
                confirm &&
                run(confirm.offer.id, () => cancelOffer(supabase, { offerId: confirm.offer.id, bidderId: viewerId! }), {
                  title: "Offer withdrawn",
                  message: `${confirm.offer.priceSol} SOL`,
                })
              }
            >
              Withdraw
            </Button>
          </>
        }
      >
        {confirm?.kind === "withdraw" && (
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            Withdraw your <strong style={{ color: "var(--text-primary)" }}>{confirm.offer.priceSol} SOL</strong> offer?
            Offers lock no funds, so nothing is returned — this just removes your bid. You can make a new one anytime.
          </p>
        )}
        {confirm?.kind === "withdraw" && error && (
          <p style={{ margin: "var(--space-5) 0 0", fontSize: "var(--text-xs)", color: "var(--price-down)" }}>{error}</p>
        )}
      </Dialog>
    </div>
  );
}

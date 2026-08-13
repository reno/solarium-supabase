"use client";

import {
  useSelectedWalletAccount,
  useWalletAccountTransactionSigner,
} from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ArtTile, Button, Dialog, Input, Select } from "@/components/design";
import { ProgressModal } from "@/components/progress-modal";
import { useToast } from "@/components/toast/toast-provider";
import type { ProgressStepDef } from "@/components/progress-steps";
import {
  cancelListing,
  listNft,
  type CancelStage,
  type ListStage,
} from "@/lib/listings/listings";
import { getSolanaChain } from "@/lib/solana/config";
import { lamportsToSol, solToLamports } from "@/lib/solana/lamports";
import { createUmiForWallet } from "@/lib/solana/umi";
import { createClient } from "@/lib/supabase/client";
import { FEE_LABEL } from "@/supabase/functions/_shared/fee";

const LIST_STEPS: ProgressStepDef[] = [
  { key: "checking", label: "Checking asset status" },
  { key: "signing", label: "Waiting for your wallet" },
  { key: "sending", label: "Sending transaction" },
  { key: "confirming", label: "Confirming on Solana" },
  { key: "saving", label: "Saving listing" },
];

const CANCEL_STEPS: ProgressStepDef[] = [
  { key: "signing", label: "Waiting for your wallet" },
  { key: "sending", label: "Sending transaction" },
  { key: "confirming", label: "Confirming on Solana" },
  { key: "saving", label: "Updating listing" },
];

export type OwnedNft = {
  id: string;
  name: string;
  imageUrl: string;
  assetAddress: string;
  collectionId: string | null;
  collectionAddress: string | null;
  listing: { id: string; priceLamports: string } | null;
};

export function MyNftCard({
  nft,
  userId,
  href,
  defaultPrice,
  floorSol,
  topBidSol,
  royaltyBps,
}: {
  nft: OwnedNft;
  userId: string;
  href?: string;
  defaultPrice?: string;
  floorSol?: string | null;
  topBidSol?: string | null;
  royaltyBps?: number;
}) {
  const priceSol = nft.listing ? lamportsToSol(BigInt(nft.listing.priceLamports)) : null;
  return (
    <div
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      <Link href={href ?? `/nft/${nft.id}`} style={{ display: "block", textDecoration: "none" }}>
        <div style={{ padding: "var(--space-4)", paddingBottom: 0 }}>
          <ArtTile src={nft.imageUrl} label={nft.name} alt={nft.name} sizes="(max-width: 767px) 50vw, 240px" />
        </div>
        <div style={{ padding: "var(--space-5) var(--space-5) 0" }}>
          <div
            style={{
              fontSize: "var(--text-md)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--text-primary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {nft.name}
          </div>
          {priceSol ? (
            <div style={{ marginTop: "var(--space-3)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>
              {priceSol}
              <span style={{ fontSize: "0.78em", marginLeft: 3, color: "var(--text-secondary)" }}>SOL</span>
            </div>
          ) : (
            <div style={{ marginTop: "var(--space-3)", fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>Not listed</div>
          )}
        </div>
      </Link>
      <div style={{ padding: "var(--space-5)" }}>
        <OwnedNftControls nft={nft} userId={userId} defaultPrice={defaultPrice} floorSol={floorSol} topBidSol={topBidSol} royaltyBps={royaltyBps} />
      </div>
    </div>
  );
}

export function OwnedNftControls({
  nft,
  userId,
  defaultPrice,
  floorSol,
  topBidSol,
  royaltyBps,
}: {
  nft: OwnedNft;
  userId: string;
  defaultPrice?: string;
  floorSol?: string | null;
  topBidSol?: string | null;
  royaltyBps?: number;
}) {
  const [selectedWalletAccount] = useSelectedWalletAccount();
  if (!selectedWalletAccount) {
    return (
      <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
        Connect your wallet to manage this NFT.
      </p>
    );
  }
  return <CardActions account={selectedWalletAccount} nft={nft} userId={userId} defaultPrice={defaultPrice} floorSol={floorSol} topBidSol={topBidSol} royaltyBps={royaltyBps} />;
}

function CardActions({
  account,
  nft,
  userId,
  defaultPrice,
  floorSol,
  topBidSol,
  royaltyBps = 0,
}: {
  account: UiWalletAccount;
  nft: OwnedNft;
  userId: string;
  defaultPrice?: string;
  floorSol?: string | null;
  topBidSol?: string | null;
  royaltyBps?: number;
}) {
  const [price, setPrice] = useState(defaultPrice ?? "");
  const [expiry, setExpiry] = useState("Never");
  const [confirmDelist, setConfirmDelist] = useState(false);
  const [action, setAction] = useState<"list" | "cancel" | null>(null);
  const [phase, setPhase] = useState<"idle" | "active" | "error">("idle");
  const [stage, setStage] = useState<ListStage | CancelStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kitSigner = useWalletAccountTransactionSigner(account, getSolanaChain());
  const umi = useMemo(() => createUmiForWallet(kitSigner), [kitSigner]);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();
  const busy = phase === "active";

  const run = async (kind: "list" | "cancel", perform: () => Promise<unknown>) => {
    setAction(kind);
    setPhase("active");
    setError(null);
    try {
      await perform();
      setPhase("idle");
      setAction(null);
      showToast(
        kind === "list"
          ? { type: "success", title: "Listing live", message: nft.name }
          : { type: "success", title: "Listing cancelled", message: `${nft.name} · stays in your wallet` }
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {nft.listing ? (
        <Button
          variant="secondary"
          size="sm"
          block
          icon="x"
          loading={busy && action === "cancel"}
          disabled={busy}
          onClick={() => setConfirmDelist(true)}
        >
          Cancel listing
        </Button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div style={{ display: "flex", gap: "var(--space-4)" }}>
            <Input
              size="sm"
              numeric
              suffix="SOL"
              inputMode="decimal"
              placeholder="Price"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              containerStyle={{ flex: 1, minWidth: 0 }}
            />
            <Select
              size="sm"
              options={["Never", "24h", "7d", "30d"]}
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
            />
          </div>

          {(floorSol || topBidSol) && (
            <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
              {floorSol ? <QuickFill label="Floor" onClick={() => setPrice(floorSol)} /> : null}
              {topBidSol ? <QuickFill label="Top bid" onClick={() => setPrice(topBidSol)} /> : null}
              {floorSol ? <QuickFill label="Floor +10%" onClick={() => setPrice((parseFloat(floorSol) * 1.1).toFixed(4))} /> : null}
            </div>
          )}

          {price.trim() ? (
            <ReceiveLine price={price} floorSol={floorSol} royaltyBps={royaltyBps} />
          ) : null}

          <Button
            variant="primary"
            size="sm"
            block
            loading={busy && action === "list"}
            disabled={busy || !price.trim()}
            onClick={() =>
              run("list", async () => {
                let priceLamports: bigint;
                try {
                  priceLamports = solToLamports(price);
                } catch {
                  throw new Error("Enter a valid SOL amount, e.g. 0.5 (up to 9 decimals).");
                }
                const hours: Record<string, number | null> = { Never: null, "24h": 24, "7d": 168, "30d": 720 };
                await listNft({
                  supabase,
                  umi,
                  nft: {
                    id: nft.id,
                    assetAddress: nft.assetAddress,
                    collectionAddress: nft.collectionAddress,
                  },
                  sellerId: userId,
                  priceLamports,
                  expiresInHours: hours[expiry],
                  onStage: setStage,
                });
                setPrice("");
                setExpiry("Never");
              })
            }
          >
            List
          </Button>
        </div>
      )}
      <Dialog
        open={confirmDelist}
        onClose={() => setConfirmDelist(false)}
        title="Cancel listing"
        footer={
          <>
            <Button variant="ghost" block onClick={() => setConfirmDelist(false)}>Keep listed</Button>
            <Button
              variant="primary"
              block
              onClick={() => {
                setConfirmDelist(false);
                run("cancel", () =>
                  cancelListing({
                    supabase,
                    umi,
                    nft: {
                      id: nft.id,
                      assetAddress: nft.assetAddress,
                      collectionAddress: nft.collectionAddress,
                    },
                    listingId: nft.listing!.id,
                    sellerId: userId,
                    onStage: setStage,
                  })
                );
              }}
            >
              Delist
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
          <strong style={{ color: "var(--text-primary)" }}>{nft.name}</strong> will be removed from sale. It stays in
          your wallet — you can relist it anytime.
        </p>
      </Dialog>

      {phase !== "idle" && action && (
        <ProgressModal
          title={action === "list" ? "Listing NFT" : "Cancelling listing"}
          steps={action === "list" ? LIST_STEPS : CANCEL_STEPS}
          currentKey={stage}
          status={phase === "error" ? "error" : "active"}
          errorMessage={error}
          onClose={() => {
            setPhase("idle");
            setAction(null);
            setStage(null);
          }}
        />
      )}
    </div>
  );
}

function QuickFill({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "2px var(--space-4)",
        borderRadius: "var(--radius-xs)",
        border: "1px solid var(--border-subtle)",
        background: "var(--surface-2)",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-2xs)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function ReceiveLine({ price, floorSol, royaltyBps }: { price: string; floorSol?: string | null; royaltyBps: number }) {
  const p = parseFloat(price);
  const below = floorSol != null && Number.isFinite(p) && p < parseFloat(floorSol);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
        You receive {Number.isFinite(p) ? p : "—"} SOL · buyer pays +{FEE_LABEL} fee{royaltyBps ? ` + ${(royaltyBps / 100).toFixed(1)}% royalty` : ""}
      </span>
      {below ? (
        <span style={{ fontSize: "var(--text-2xs)", color: "var(--price-down)" }}>Below floor ({floorSol} SOL)</span>
      ) : null}
    </div>
  );
}

"use client";

import {
  useSelectedWalletAccount,
  useWalletAccountTransactionSigner,
} from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, Input, Select } from "@/components/design";
import type { OwnedNft } from "@/components/listings/my-nft-card";
import { ProgressModal } from "@/components/progress-modal";
import type { ProgressStepDef } from "@/components/progress-steps";
import { useToast } from "@/components/toast/toast-provider";
import { listNfts, type BulkListStage } from "@/lib/listings/listings";
import { getSolanaChain } from "@/lib/solana/config";
import { solToLamports } from "@/lib/solana/lamports";
import { createUmiForWallet } from "@/lib/solana/umi";
import { createClient } from "@/lib/supabase/client";

const EXPIRY_HOURS: Record<string, number | null> = { Never: null, "24h": 24, "7d": 168, "30d": 720 };

/**
 * "List all N at the phase price" — the step that actually opens a drop for minting. A phase only
 * sets the schedule and price; buyers mint by buying the creator's listings, so a drop with no
 * listings has nothing to sell.
 */
export function BulkListButton({
  nfts,
  userId,
  defaultPrice,
}: {
  /** Unlisted items only — anything already listed is skipped by the caller. */
  nfts: OwnedNft[];
  userId: string;
  /** The active phase's price, so the whole supply opens at the advertised price. */
  defaultPrice?: string;
}) {
  const [selectedWalletAccount] = useSelectedWalletAccount();
  if (nfts.length === 0) return null;
  if (!selectedWalletAccount) {
    return (
      <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
        Connect your wallet to list all {nfts.length} items at once.
      </p>
    );
  }
  return <BulkListForm account={selectedWalletAccount} nfts={nfts} userId={userId} defaultPrice={defaultPrice} />;
}

function BulkListForm({
  account,
  nfts,
  userId,
  defaultPrice,
}: {
  account: UiWalletAccount;
  nfts: OwnedNft[];
  userId: string;
  defaultPrice?: string;
}) {
  const [price, setPrice] = useState(defaultPrice ?? "");
  const [expiry, setExpiry] = useState("Never");
  const [phase, setPhase] = useState<"idle" | "active" | "error">("idle");
  const [stage, setStage] = useState<BulkListStage | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const kitSigner = useWalletAccountTransactionSigner(account, getSolanaChain());
  const umi = useMemo(() => createUmiForWallet(kitSigner), [kitSigner]);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();
  const busy = phase === "active";

  // The wallet prompts once per transaction, and several delegate grants fit in one — so the
  // count isn't known until the batch is packed. Until then, say what's happening, not how often.
  const steps: ProgressStepDef[] = [
    { key: "checking", label: `Checking ${nfts.length} assets` },
    {
      key: "sending",
      label: progress.total
        ? `Approving and sending · ${progress.done} of ${progress.total} transactions`
        : "Approving and sending",
    },
    { key: "saving", label: "Saving listings" },
  ];

  const listAll = async () => {
    setPhase("active");
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      let priceLamports: bigint;
      try {
        priceLamports = solToLamports(price);
      } catch {
        throw new Error("Enter a valid SOL amount, e.g. 0.5 (up to 9 decimals).");
      }
      const { listed } = await listNfts({
        supabase,
        umi,
        nfts: nfts.map((n) => ({
          id: n.id,
          assetAddress: n.assetAddress,
          collectionAddress: n.collectionAddress,
        })),
        sellerId: userId,
        priceLamports,
        expiresInHours: EXPIRY_HOURS[expiry],
        onStage: setStage,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setPhase("idle");
      setStage(null);
      showToast({
        type: "success",
        title: `${listed} item${listed === 1 ? "" : "s"} listed`,
        message: `Mint is open at ${price} SOL`,
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
      // A partial run still listed something; refresh so the page reflects what landed.
      router.refresh();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center", flexWrap: "wrap" }}>
        <Input
          size="sm"
          numeric
          suffix="SOL"
          inputMode="decimal"
          placeholder="Price"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          containerStyle={{ width: 140 }}
        />
        <Select
          size="sm"
          options={Object.keys(EXPIRY_HOURS)}
          value={expiry}
          onChange={(event) => setExpiry(event.target.value)}
        />
        <Button
          variant="primary"
          size="sm"
          icon="zap"
          loading={busy}
          disabled={busy || !price.trim()}
          onClick={listAll}
        >
          List all {nfts.length}
        </Button>
      </div>
      <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
        Grants the settlement authority transfer rights on each item, batched into as few wallet
        approvals as fit — your wallet will prompt more than once for a large drop.
      </span>

      {phase !== "idle" && (
        <ProgressModal
          title={`Listing ${nfts.length} items`}
          steps={steps}
          currentKey={stage}
          status={phase === "error" ? "error" : "active"}
          errorMessage={error}
          onClose={() => {
            setPhase("idle");
            setStage(null);
          }}
        />
      )}
    </div>
  );
}

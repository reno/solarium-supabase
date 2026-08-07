"use client";

import {
  useSelectedWalletAccount,
  useWalletAccountTransactionSigner,
} from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, IconButton } from "@/components/design";
import { BUY_STEPS } from "@/components/listings/buy-button";
import { TxFlow, type TxStage } from "@/components/tx/tx-flow";
import { useToast } from "@/components/toast/toast-provider";
import { mintFromCandyMachine } from "@/lib/launchpad/candy-machine";
import { buyListing } from "@/lib/listings/buy";
import { explorerTxUrl, getSolanaChain } from "@/lib/solana/config";
import { useSolBalance } from "@/lib/solana/use-balance";
import { createUmiForWallet } from "@/lib/solana/umi";
import { createClient } from "@/lib/supabase/client";

/**
 * A drop mints one of two ways, and this button is the seam between them.
 *
 * listing-backed  "Mint" = buy the next creator-listed edition through the verified settlement
 *                 flow. Phase window / allowlist / per-wallet limit are enforced app-side and
 *                 arrive as `disabledReason` — advisory only.
 * candy machine   "Mint" = the buyer's own wallet calls `mintV1`. The same rules are guards on
 *                 chain, so `disabledReason` becomes a courtesy: a buyer who gets past it still
 *                 can't mint outside their phase, over their limit, or off the allowlist.
 *
 * The dialog differs too. A listing purchase pays the seller plus fee plus royalty on top; a
 * candy-machine mint pays the guard's price plus the platform's fixed fee, and the creator
 * royalty is a plugin on the collection that applies to secondary sales, not to the mint.
 */
export type CandyMachineMintSource = {
  collectionId: string;
  candyMachine: string;
  candyGuard: string;
  collectionAddress: string;
  creatorWallet: string;
  treasuryWallet: string | null;
  guardLabel: string;
  /** Non-null only when the active phase is allowlist-gated; the proof is built from it. */
  allowlist: string[] | null;
  itemsRemaining: number;
};

export function LaunchpadMintButton({
  availableListingIds,
  candyMachine = null,
  priceSol,
  viewerId,
  disabledReason,
  perWalletRemaining,
  phaseName,
  royaltyBps,
  revealAt,
  solUsd,
}: {
  availableListingIds: string[];
  candyMachine?: CandyMachineMintSource | null;
  priceSol: string | null;
  viewerId: string | null;
  disabledReason: string | null;
  perWalletRemaining: number | null;
  phaseName: string | null;
  royaltyBps: number;
  revealAt: string | null;
  solUsd?: number;
}) {
  const [account] = useSelectedWalletAccount();

  if (disabledReason) {
    return (
      <Button variant="primary" size="lg" block disabled>
        {disabledReason}
      </Button>
    );
  }
  if (!viewerId) {
    return (
      <Button variant="primary" size="lg" block disabled>
        Sign in to mint
      </Button>
    );
  }
  if (!account) {
    return (
      <Button variant="primary" size="lg" block disabled>
        Connect wallet to mint
      </Button>
    );
  }
  const available = candyMachine ? candyMachine.itemsRemaining : availableListingIds.length;
  if (available === 0) {
    return (
      <Button variant="primary" size="lg" block disabled>
        Sold out
      </Button>
    );
  }
  return (
    <Inner
      account={account}
      availableListingIds={availableListingIds}
      candyMachine={candyMachine}
      available={available}
      priceSol={priceSol ?? ""}
      perWalletRemaining={perWalletRemaining}
      phaseName={phaseName}
      royaltyBps={royaltyBps}
      revealAt={revealAt}
      solUsd={solUsd}
    />
  );
}

// The candy-machine flow's stages. "Proving allowlist" is a real extra transaction — the merkle
// proof is written to a PDA before the mint — so it is only listed when the phase is gated;
// showing a step that will never run reads as a hang.
function candyMintSteps(gated: boolean): TxStage[] {
  return [
    ...(gated ? [{ key: "allowlist", label: "Proving allowlist" }] : []),
    { key: "signing", label: "Waiting for your wallet" },
    { key: "sending", label: "Sending transaction" },
    { key: "confirming", label: "Confirming on Solana" },
    { key: "recording", label: "Recording your mint" },
  ];
}

function revealLabel(revealAt: string | null): string | null {
  if (!revealAt) return null;
  const ms = new Date(revealAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return `Art reveals in ${Math.floor(h / 24)}d`;
  if (h >= 1) return `Art reveals in ${h}h`;
  return `Art reveals in ${Math.ceil(ms / 60_000)}m`;
}

function Inner({
  account,
  availableListingIds,
  candyMachine,
  available,
  priceSol,
  perWalletRemaining,
  phaseName,
  royaltyBps,
  revealAt,
  solUsd,
}: {
  account: UiWalletAccount;
  availableListingIds: string[];
  candyMachine: CandyMachineMintSource | null;
  available: number;
  priceSol: string;
  perWalletRemaining: number | null;
  phaseName: string | null;
  royaltyBps: number;
  revealAt: string | null;
  solUsd?: number;
}) {
  const kitSigner = useWalletAccountTransactionSigner(account, getSolanaChain());
  const umi = useMemo(() => createUmiForWallet(kitSigner), [kitSigner]);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();
  const balanceLamports = useSolBalance(account.address);

  const maxQty = Math.max(1, Math.min(available, perWalletRemaining ?? available));
  const [qty, setQty] = useState(1);
  const [flowOpen, setFlowOpen] = useState(false);
  const clampedQty = Math.min(qty, maxQty);

  const priceNum = parseFloat(priceSol) || 0;
  const feePer = priceNum * 0.02;
  // A candy-machine mint is a primary sale: the creator is the seller, so there is no royalty leg
  // to pay them on top of their own price. Royalties are on the collection and apply on resale.
  const royPer = candyMachine ? 0 : (priceNum * royaltyBps) / 10000;
  const perItem = priceNum + feePer + royPer;
  const totalNum = perItem * clampedQty;
  const reveal = revealLabel(revealAt);

  return (
    <>
      {maxQty > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-5)" }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Quantity</span>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
            <IconButton icon="minus" label="Decrease" size="sm" disabled={clampedQty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))} />
            <span style={{ minWidth: 24, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>{clampedQty}</span>
            <IconButton icon="plus" label="Increase" size="sm" disabled={clampedQty >= maxQty} onClick={() => setQty((q) => Math.min(maxQty, q + 1))} />
          </div>
        </div>
      )}

      <Button variant="primary" size="lg" icon="sparkle" block onClick={() => setFlowOpen(true)}>
        Mint {clampedQty > 1 ? `${clampedQty} · ` : ""}{(perItem * clampedQty).toFixed(3)} SOL
      </Button>

      {flowOpen && (
        <TxFlow
          open
          onClose={() => setFlowOpen(false)}
          onDone={() => {
            showToast({ type: "success", title: "Mint confirmed", message: `${clampedQty} × ${phaseName ?? "item"}` });
            router.refresh();
          }}
          config={{
            title: phaseName ? `Mint · ${phaseName}` : "Mint",
            approveLabel: "Approve & mint",
            lines: [
              { label: `Price × ${clampedQty}`, value: `${(priceNum * clampedQty).toFixed(4)} SOL` },
              { label: "Marketplace fee (2.0%)", value: `${(feePer * clampedQty).toFixed(4)} SOL`, muted: true },
              ...(royPer ? [{ label: `Creator royalty (${(royaltyBps / 100).toFixed(1)}%)`, value: `${(royPer * clampedQty).toFixed(4)} SOL`, muted: true }] : []),
              ...(reveal ? [{ label: "Reveal", value: reveal, muted: true }] : []),
            ],
            total: { label: "You pay", value: `${totalNum.toFixed(4)} SOL` },
            fiatUsd: solUsd ? totalNum * solUsd : null,
            balanceSol: balanceLamports != null ? Number(balanceLamports) / 1e9 : null,
            needSol: totalNum,
            stages: candyMachine ? candyMintSteps(candyMachine.allowlist !== null) : BUY_STEPS,
            // Either way, one transaction per item — a candy machine mints one asset per `mintV1`,
            // and a listing purchase settles one listing per transaction.
            perform: async (onStage) => {
              let last: { signature: string } | undefined;
              if (candyMachine) {
                for (let i = 0; i < clampedQty; i += 1) {
                  last = await mintFromCandyMachine({
                    supabase,
                    umi,
                    collectionId: candyMachine.collectionId,
                    candyMachine: candyMachine.candyMachine,
                    candyGuard: candyMachine.candyGuard,
                    collectionAddress: candyMachine.collectionAddress,
                    creatorWallet: candyMachine.creatorWallet,
                    treasuryWallet: candyMachine.treasuryWallet,
                    guardLabel: candyMachine.guardLabel,
                    allowlist: candyMachine.allowlist,
                    onStage: (s) => onStage(s),
                  });
                }
                return last ?? {};
              }
              for (const listingId of availableListingIds.slice(0, clampedQty)) {
                last = await buyListing({ supabase, umi, listingId, onStage: onStage as (s: string) => void });
              }
              return last ?? {};
            },
            successTitle: clampedQty > 1 ? `Minted ${clampedQty} items` : "Mint confirmed",
            successDetail: reveal ? `${reveal}.` : undefined,
            explorerUrl: explorerTxUrl,
            errorHint: candyMachine
              ? "If your wallet never prompted or you rejected it, no SOL left your wallet. If it minted but recording failed, the item is already yours on chain — reload to see it."
              : "If your wallet never prompted or you rejected it, no SOL left your wallet.",
          }}
        />
      )}
    </>
  );
}

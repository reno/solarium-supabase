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
import { TxFlow } from "@/components/tx/tx-flow";
import { useToast } from "@/components/toast/toast-provider";
import { buyListing } from "@/lib/listings/buy";
import { explorerTxUrl, getSolanaChain } from "@/lib/solana/config";
import { useSolBalance } from "@/lib/solana/use-balance";
import { createUmiForWallet } from "@/lib/solana/umi";
import { createClient } from "@/lib/supabase/client";
import { FEE_LABEL, FEE_RATE } from "@/supabase/functions/_shared/fee";

export function LaunchpadMintButton({
  availableListingIds,
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
  if (availableListingIds.length === 0) {
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
      priceSol={priceSol ?? ""}
      perWalletRemaining={perWalletRemaining}
      phaseName={phaseName}
      royaltyBps={royaltyBps}
      revealAt={revealAt}
      solUsd={solUsd}
    />
  );
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
  priceSol,
  perWalletRemaining,
  phaseName,
  royaltyBps,
  revealAt,
  solUsd,
}: {
  account: UiWalletAccount;
  availableListingIds: string[];
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

  const maxQty = Math.max(1, Math.min(availableListingIds.length, perWalletRemaining ?? availableListingIds.length));
  const [qty, setQty] = useState(1);
  const [flowOpen, setFlowOpen] = useState(false);
  const clampedQty = Math.min(qty, maxQty);

  const priceNum = parseFloat(priceSol) || 0;
  const feePer = priceNum * FEE_RATE;
  const royPer = (priceNum * royaltyBps) / 10000;
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
              { label: `Marketplace fee (${FEE_LABEL})`, value: `${(feePer * clampedQty).toFixed(4)} SOL`, muted: true },
              ...(royaltyBps ? [{ label: `Creator royalty (${(royaltyBps / 100).toFixed(1)}%)`, value: `${(royPer * clampedQty).toFixed(4)} SOL`, muted: true }] : []),
              ...(reveal ? [{ label: "Reveal", value: reveal, muted: true }] : []),
            ],
            total: { label: "You pay", value: `${totalNum.toFixed(4)} SOL` },
            fiatUsd: solUsd ? totalNum * solUsd : null,
            balanceSol: balanceLamports != null ? Number(balanceLamports) / 1e9 : null,
            needSol: totalNum,
            stages: BUY_STEPS,
            perform: async (onStage) => {
              let last: { signature: string } | undefined;
              for (const listingId of availableListingIds.slice(0, clampedQty)) {
                last = await buyListing({ supabase, umi, listingId, onStage: onStage as (s: string) => void });
              }
              return last ?? {};
            },
            successTitle: clampedQty > 1 ? `Minted ${clampedQty} items` : "Mint confirmed",
            successDetail: reveal ? `${reveal}.` : undefined,
            explorerUrl: explorerTxUrl,
            errorHint: "If your wallet never prompted or you rejected it, no SOL left your wallet.",
          }}
        />
      )}
    </>
  );
}

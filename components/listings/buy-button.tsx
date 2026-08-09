"use client";

import {
  useSelectedWalletAccount,
  useWalletAccountTransactionSigner,
} from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/design";
import { TxFlow, type TxStage } from "@/components/tx/tx-flow";
import { useToast } from "@/components/toast/toast-provider";
import { buyListing } from "@/lib/listings/buy";
import { solToLamports } from "@/lib/solana/lamports";
import { explorerTxUrl, getSolanaChain } from "@/lib/solana/config";
import { useSolBalance } from "@/lib/solana/use-balance";
import { createUmiForWallet } from "@/lib/solana/umi";
import { createClient } from "@/lib/supabase/client";
import { FEE_LABEL, feeOf } from "@/supabase/functions/_shared/fee";

export const BUY_STEPS: TxStage[] = [
  { key: "preparing", label: "Verifying listing" },
  { key: "signing", label: "Waiting for your wallet" },
  { key: "sending", label: "Sending transaction" },
  { key: "confirming", label: "Confirming on Solana" },
  { key: "recording", label: "Recording your purchase" },
];

export function BuyButton({
  listingId,
  sellerId,
  priceSol,
  viewerId,
  itemName,
  collectionName,
  royaltyBps,
  solUsd,
}: {
  listingId: string;
  sellerId: string;
  priceSol: string;
  viewerId: string | null;
  itemName?: string;
  collectionName?: string;
  royaltyBps?: number;
  solUsd?: number;
}) {
  const [selectedWalletAccount] = useSelectedWalletAccount();

  if (!viewerId) {
    return (
      <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
        Sign in with your wallet to buy.
      </p>
    );
  }
  if (viewerId === sellerId) {
    return (
      <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>Your listing</p>
    );
  }
  if (!selectedWalletAccount) {
    return (
      <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
        Connect your wallet to buy.
      </p>
    );
  }
  return (
    <BuyButtonInner
      account={selectedWalletAccount}
      listingId={listingId}
      priceSol={priceSol}
      itemName={itemName}
      collectionName={collectionName}
      royaltyBps={royaltyBps}
      solUsd={solUsd}
    />
  );
}

function BuyButtonInner({
  account,
  listingId,
  priceSol,
  itemName,
  collectionName,
  royaltyBps,
  solUsd,
}: {
  account: UiWalletAccount;
  listingId: string;
  priceSol: string;
  itemName?: string;
  collectionName?: string;
  royaltyBps?: number;
  solUsd?: number;
}) {
  const [flowOpen, setFlowOpen] = useState(false);
  const [bought, setBought] = useState(false);
  const kitSigner = useWalletAccountTransactionSigner(account, getSolanaChain());
  const umi = useMemo(() => createUmiForWallet(kitSigner), [kitSigner]);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();
  const balanceLamports = useSolBalance(account.address);

  if (bought) {
    return (
      <p style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)", color: "var(--price-up)" }}>
        It&apos;s yours!
      </p>
    );
  }

  // The quote is computed in lamports and only then rendered, so the figure shown and the cap
  // handed to buyListing are the same number rather than two roundings of it. `royaltyBps` has
  // already had the creator carve-out applied by the caller (see splitApplies in settle).
  const priceLamports = solToLamports(priceSol);
  const feeLamports = feeOf(priceLamports);
  const royaltyLamports = (priceLamports * BigInt(royaltyBps ?? 0)) / 10000n;
  const totalLamports = priceLamports + feeLamports + royaltyLamports;

  const royPct = (royaltyBps ?? 0) / 100;
  const feeSol = Number(feeLamports) / 1e9;
  const roySol = Number(royaltyLamports) / 1e9;
  const totalNum = Number(totalLamports) / 1e9;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <Button variant="primary" icon="zap" onClick={() => setFlowOpen(true)}>
        Buy for {priceSol} SOL
      </Button>
      {flowOpen && (
        <TxFlow
          open
          onClose={() => setFlowOpen(false)}
          onDone={() => {
            setBought(true);
            showToast({ type: "success", title: "Purchase confirmed", message: `${itemName ?? "Item"} · ${priceSol} SOL` });
            router.refresh();
          }}
          config={{
            title: itemName ? `Buy ${itemName}` : "Buy item",
            approveLabel: "Approve & pay",
            lines: [
              { label: collectionName ? `Price · ${collectionName}` : "Price", value: `${priceSol} SOL` },
              { label: `Marketplace fee (${FEE_LABEL})`, value: `${feeSol.toFixed(4)} SOL`, muted: true },
              ...(royaltyBps ? [{ label: `Creator royalty (${royPct.toFixed(1)}%)`, value: `${roySol.toFixed(4)} SOL`, muted: true }] : []),
            ],
            total: { label: "You pay", value: `${totalNum.toFixed(4)} SOL` },
            fiatUsd: solUsd ? totalNum * solUsd : null,
            balanceSol: balanceLamports != null ? Number(balanceLamports) / 1e9 : null,
            needSol: totalNum,
            stages: BUY_STEPS,
            perform: (onStage) =>
              buyListing({
                supabase,
                umi,
                listingId,
                maxLamports: totalLamports,
                onStage: onStage as (s: string) => void,
              }),
            successTitle: "Purchase confirmed",
            successDetail: itemName ? `${itemName} is now yours.` : undefined,
            explorerUrl: explorerTxUrl,
            errorHint: "If your wallet never prompted or you rejected it, no SOL left your wallet.",
          }}
        />
      )}
    </div>
  );
}

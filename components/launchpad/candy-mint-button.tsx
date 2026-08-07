"use client";

import { useSelectedWalletAccount, useWalletAccountTransactionSigner } from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, IconButton } from "@/components/design";
import { useToast } from "@/components/toast/toast-provider";
import { TxFlow } from "@/components/tx/tx-flow";
import { deserializePhases, type SerializedPhase } from "@/components/launchpad/candy-machine-panel";
import { feeOf } from "@/lib/launchpad/candy-guards";
import { mintFromCandyMachine } from "@/lib/launchpad/candy-machine";
import { explorerTxUrl, getSolanaChain } from "@/lib/solana/config";
import { lamportsToSol } from "@/lib/solana/lamports";
import { useSolBalance } from "@/lib/solana/use-balance";
import { createUmiForWallet } from "@/lib/solana/umi";
import { createClient } from "@/lib/supabase/client";

/**
 * Mint from the drop's candy machine.
 *
 * The difference from the listing-based mint button is where the rules live. There, the button
 * was disabled by the server's read of the phase and the mint was a purchase of a pre-minted
 * item; here the guards are the rule, and a disabled button is only a courtesy — a wallet that
 * ignores it still gets rejected by the program. So the gating copy stays, but the failure it
 * prevents is a wasted signature, not a rule being broken.
 */

const MINT_STAGES = [
  { key: "allowlist", label: "Proving allowlist membership" },
  { key: "signing", label: "Approve in your wallet" },
  { key: "sending", label: "Sending the mint" },
  { key: "confirming", label: "Confirming on chain" },
  { key: "recording", label: "Recording your item" },
];

export function CandyMintButton({
  collectionId,
  collectionAddress,
  candyMachineAddress,
  creatorWallet,
  allowlist,
  phase,
  viewerId,
  disabledReason,
  available,
  perWalletRemaining,
  royaltyBps,
  revealAt,
  solUsd,
}: {
  collectionId: string;
  collectionAddress: string;
  candyMachineAddress: string;
  creatorWallet: string;
  allowlist: string[];
  phase: SerializedPhase;
  viewerId: string | null;
  disabledReason: string | null;
  available: number;
  perWalletRemaining: number | null;
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
  if (available <= 0) {
    return (
      <Button variant="primary" size="lg" block disabled>
        Minted out
      </Button>
    );
  }
  return (
    <Inner
      account={account}
      collectionId={collectionId}
      collectionAddress={collectionAddress}
      candyMachineAddress={candyMachineAddress}
      creatorWallet={creatorWallet}
      allowlist={allowlist}
      phase={phase}
      available={available}
      perWalletRemaining={perWalletRemaining}
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
  collectionId,
  collectionAddress,
  candyMachineAddress,
  creatorWallet,
  allowlist,
  phase,
  available,
  perWalletRemaining,
  royaltyBps,
  revealAt,
  solUsd,
}: {
  account: UiWalletAccount;
  collectionId: string;
  collectionAddress: string;
  candyMachineAddress: string;
  creatorWallet: string;
  allowlist: string[];
  phase: SerializedPhase;
  available: number;
  perWalletRemaining: number | null;
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

  const priceLamports = BigInt(phase.priceLamports);
  const feeLamports = feeOf(priceLamports);
  const perItem = priceLamports + feeLamports;
  const totalNum = Number(perItem * BigInt(clampedQty)) / 1e9;
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
        Mint {clampedQty > 1 ? `${clampedQty} · ` : ""}
        {totalNum.toFixed(3)} SOL
      </Button>

      {flowOpen && (
        <TxFlow
          open
          onClose={() => setFlowOpen(false)}
          onDone={() => {
            showToast({ type: "success", title: "Mint confirmed", message: `${clampedQty} × ${phase.name}` });
            router.refresh();
          }}
          config={{
            title: `Mint · ${phase.name}`,
            approveLabel: "Approve & mint",
            lines: [
              { label: `Price × ${clampedQty}`, value: `${lamportsToSol(priceLamports * BigInt(clampedQty))} SOL` },
              { label: "Marketplace fee (2.0%)", value: `${lamportsToSol(feeLamports * BigInt(clampedQty))} SOL`, muted: true },
              // Royalties are a secondary-sale split; a primary mint pays the creator directly, so
              // there is nothing to take a cut of here.
              ...(royaltyBps ? [{ label: "Creator royalty", value: "On resale only", muted: true }] : []),
              ...(reveal ? [{ label: "Reveal", value: reveal, muted: true }] : []),
              ...(clampedQty > 1 ? [{ label: "Wallet approvals", value: String(clampedQty), muted: true }] : []),
            ],
            total: { label: "You pay", value: `${totalNum.toFixed(4)} SOL` },
            fiatUsd: solUsd ? totalNum * solUsd : null,
            balanceSol: balanceLamports != null ? Number(balanceLamports) / 1e9 : null,
            needSol: totalNum,
            stages: MINT_STAGES,
            // One transaction per item — the machine mints a single asset per instruction, and the
            // wallet bridge signs one transaction per approval anyway.
            perform: async (onStage) => {
              const [deserialized] = deserializePhases([phase]);
              const minted: string[] = [];
              let last: string | undefined;
              try {
                for (let i = 0; i < clampedQty; i++) {
                  const result = await mintFromCandyMachine({
                    supabase,
                    umi,
                    collectionId,
                    collectionAddress,
                    candyMachineAddress,
                    creatorWallet,
                    allowlist,
                    phase: { ...deserialized, groupLabel: phase.groupLabel! },
                    onStage: (stage) => onStage(stage),
                  });
                  minted.push(result.assetAddress);
                  last = result.signature;
                }
              } catch (e) {
                // Partial fills are real: each item is its own transaction, so item 3 of 5 can fail
                // after two have already been paid for and minted. Say so instead of implying none.
                if (minted.length === 0) throw e;
                throw new Error(
                  `Minted ${minted.length} of ${clampedQty} before stopping: ${e instanceof Error ? e.message : String(e)}`
                );
              }
              return {
                signature: last,
                summary: minted.length > 1 ? `${minted.length} items minted.` : undefined,
              };
            },
            successTitle: clampedQty > 1 ? `Minted ${clampedQty} items` : "Mint confirmed",
            successDetail: reveal ? `${reveal}.` : "It's in your wallet and your portfolio.",
            explorerUrl: explorerTxUrl,
            errorHint:
              "The guards run inside your own transaction — if it was rejected, nothing left your wallet beyond the network fee.",
          }}
        />
      )}
    </>
  );
}

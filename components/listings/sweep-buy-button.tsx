"use client";

import {
  useSelectedWalletAccount,
  useWalletAccountTransactionSigner,
} from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/design";
import { BUY_STEPS } from "@/components/listings/buy-button";
import { TxFlow, type TxLine } from "@/components/tx/tx-flow";
import { useToast } from "@/components/toast/toast-provider";
import { buyListing } from "@/lib/listings/buy";
import { explorerTxUrl, getSolanaChain } from "@/lib/solana/config";
import { useSolBalance } from "@/lib/solana/use-balance";
import { createUmiForWallet } from "@/lib/solana/umi";
import { createClient } from "@/lib/supabase/client";

export type SweepItem = { id: string; name: string; priceSol: string; listingId: string };

/**
 * Buys every selected item in a sweep. The design settles a sweep in one atomic transaction;
 * Solana transaction-size limits make a single tx across N transfer+payment legs impractical, so
 * this runs the buys **sequentially** through TxFlow and reports partial fills honestly ("bought k
 * of N; the rest were not charged") rather than pretending atomicity.
 */
export function SweepBuyButton({ items, royaltyBps, onDone, solUsd }: { items: SweepItem[]; royaltyBps: number; onDone: () => void; solUsd?: number }) {
  const [account] = useSelectedWalletAccount();
  const { showToast } = useToast();

  if (!account) {
    return (
      <Button variant="primary" icon="zap" onClick={() => showToast({ type: "info", title: "Connect a wallet", message: "Connect to sweep the floor." })}>
        Buy now
      </Button>
    );
  }
  return <Inner account={account} items={items} royaltyBps={royaltyBps} onDone={onDone} solUsd={solUsd} />;
}

function Inner({ account, items, royaltyBps, onDone, solUsd }: { account: UiWalletAccount; items: SweepItem[]; royaltyBps: number; onDone: () => void; solUsd?: number }) {
  const kitSigner = useWalletAccountTransactionSigner(account, getSolanaChain());
  const umi = useMemo(() => createUmiForWallet(kitSigner), [kitSigner]);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();
  const balanceLamports = useSolBalance(account.address);
  const [open, setOpen] = useState(false);

  const priceTotal = items.reduce((s, it) => s + parseFloat(it.priceSol), 0);
  const fee = priceTotal * 0.02;
  const roy = (priceTotal * royaltyBps) / 10000;
  const total = priceTotal + fee + roy;

  // Item rows (cap the visible list so a big sweep doesn't make an unwieldy dialog).
  const CAP = 6;
  const itemLines: TxLine[] = items.slice(0, CAP).map((it) => ({ label: it.name, value: `${it.priceSol} SOL`, muted: true }));
  if (items.length > CAP) itemLines.push({ label: `+${items.length - CAP} more items`, value: "", muted: true });

  return (
    <>
      <Button variant="primary" icon="zap" onClick={() => setOpen(true)}>
        Buy now
      </Button>
      {open && (
        <TxFlow
          open
          onClose={() => setOpen(false)}
          onDone={(r) => {
            showToast({ type: "success", title: "Sweep complete", message: r.summary ?? `${items.length} items` });
            onDone();
            router.refresh();
          }}
          config={{
            title: `Sweep ${items.length} item${items.length === 1 ? "" : "s"}`,
            approveLabel: `Approve & buy ${items.length}`,
            lines: [
              ...itemLines,
              { label: "Marketplace fee (2.0%)", value: `${fee.toFixed(4)} SOL`, muted: true },
              ...(royaltyBps ? [{ label: `Creator royalty (${(royaltyBps / 100).toFixed(1)}%)`, value: `${roy.toFixed(4)} SOL`, muted: true }] : []),
            ],
            total: { label: "You pay", value: `${total.toFixed(4)} SOL` },
            fiatUsd: solUsd ? total * solUsd : null,
            balanceSol: balanceLamports != null ? Number(balanceLamports) / 1e9 : null,
            needSol: total,
            stages: BUY_STEPS,
            perform: async (onStage) => {
              let bought = 0;
              let last: { signature: string } | undefined;
              // Keep each item's real failure. Guessing at a cause ("someone else bought it")
              // reads as nonsense when the actual reason was something else entirely.
              const failed: { name: string; reason: string }[] = [];
              for (const it of items) {
                try {
                  last = await buyListing({ supabase, umi, listingId: it.listingId, onStage: onStage as (s: string) => void });
                  bought += 1;
                } catch (e) {
                  failed.push({ name: it.name, reason: e instanceof Error ? e.message : "Unknown error." });
                }
              }
              if (bought === 0) {
                const reasons = [...new Set(failed.map((f) => f.reason))].join(" ");
                throw new Error(`Nothing was bought and nothing was charged. ${reasons}`);
              }
              const summary = failed.length
                ? `Bought ${bought} of ${items.length}. ${failed.length} failed and were not charged: ${failed
                    .map((f) => `${f.name} — ${f.reason}`)
                    .join("; ")}`
                : `Bought all ${bought} items.`;
              return { signature: last?.signature, summary };
            },
            successTitle: "Sweep complete",
            explorerUrl: explorerTxUrl,
            errorHint: "Items are bought one at a time; any that didn't go through were not charged.",
            // (Own listings can't be swept — the browser filters them out before they get here.)
          }}
        />
      )}
    </>
  );
}

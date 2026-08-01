"use client";

import {
  useSelectedWalletAccount,
  useWalletAccountTransactionSigner,
} from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ProgressModal } from "@/components/progress-modal";
import type { ProgressStepDef } from "@/components/progress-steps";
import { buyListing, type BuyStage } from "@/lib/listings/buy";
import { getSolanaChain } from "@/lib/solana/config";
import { createUmiForWallet } from "@/lib/solana/umi";
import { createClient } from "@/lib/supabase/client";

const BUY_STEPS: ProgressStepDef[] = [
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
}: {
  listingId: string;
  sellerId: string;
  priceSol: string;
  viewerId: string | null;
}) {
  const [selectedWalletAccount] = useSelectedWalletAccount();

  if (!viewerId) {
    return (
      <p className="text-sm text-zinc-500">Sign in with your wallet to buy.</p>
    );
  }
  if (viewerId === sellerId) {
    return <p className="text-sm text-zinc-500">Your listing</p>;
  }
  if (!selectedWalletAccount) {
    return (
      <p className="text-sm text-zinc-500">Connect your wallet to buy.</p>
    );
  }
  return (
    <BuyButtonInner
      account={selectedWalletAccount}
      listingId={listingId}
      priceSol={priceSol}
    />
  );
}

function BuyButtonInner({
  account,
  listingId,
  priceSol,
}: {
  account: UiWalletAccount;
  listingId: string;
  priceSol: string;
}) {
  const [phase, setPhase] = useState<"idle" | "active" | "error">("idle");
  const [stage, setStage] = useState<BuyStage | null>(null);
  const [bought, setBought] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kitSigner = useWalletAccountTransactionSigner(
    account,
    getSolanaChain()
  );
  const umi = useMemo(() => createUmiForWallet(kitSigner), [kitSigner]);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  if (bought) {
    return <p className="text-sm font-medium text-green-600 dark:text-green-400">It&apos;s yours! 🎉</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        disabled={phase === "active"}
        className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-300"
        onClick={async () => {
          setPhase("active");
          setError(null);
          try {
            await buyListing({ supabase, umi, listingId, onStage: setStage });
            setBought(true);
            setPhase("idle");
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Purchase failed.");
            setPhase("error");
          }
        }}
      >
        {phase === "active" ? "Buying…" : `Buy for ${priceSol} SOL`}
      </button>
      {phase !== "idle" && (
        <ProgressModal
          title="Buying NFT"
          steps={BUY_STEPS}
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

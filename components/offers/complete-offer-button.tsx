"use client";

import {
  useSelectedWalletAccount,
  useWalletAccountTransactionSigner,
} from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/design";
import { ProgressModal } from "@/components/progress-modal";
import type { ProgressStepDef } from "@/components/progress-steps";
import { completeOffer, type CompleteStage } from "@/lib/offers/complete";
import { getSolanaChain } from "@/lib/solana/config";
import { createUmiForWallet } from "@/lib/solana/umi";
import { createClient } from "@/lib/supabase/client";

const COMPLETE_STEPS: ProgressStepDef[] = [
  { key: "preparing", label: "Verifying offer" },
  { key: "signing", label: "Waiting for your wallet" },
  { key: "sending", label: "Sending transaction" },
  { key: "confirming", label: "Confirming on Solana" },
  { key: "recording", label: "Recording your purchase" },
];

export function CompleteOfferButton({ offerId }: { offerId: string }) {
  const [account] = useSelectedWalletAccount();
  if (!account) {
    return <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>Connect wallet to complete</span>;
  }
  return <Inner account={account} offerId={offerId} />;
}

function Inner({ account, offerId }: { account: UiWalletAccount; offerId: string }) {
  const [phase, setPhase] = useState<"idle" | "active" | "error">("idle");
  const [stage, setStage] = useState<CompleteStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kitSigner = useWalletAccountTransactionSigner(account, getSolanaChain());
  const umi = useMemo(() => createUmiForWallet(kitSigner), [kitSigner]);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        icon="zap"
        loading={phase === "active"}
        disabled={phase === "active"}
        onClick={async () => {
          setPhase("active");
          setError(null);
          try {
            await completeOffer({ supabase, umi, offerId, onStage: setStage });
            setPhase("idle");
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not complete the offer.");
            setPhase("error");
          }
        }}
      >
        Complete purchase
      </Button>
      {phase !== "idle" && (
        <ProgressModal
          title="Completing purchase"
          steps={COMPLETE_STEPS}
          currentKey={stage}
          status={phase === "error" ? "error" : "active"}
          errorMessage={error}
          onClose={() => {
            setPhase("idle");
            setStage(null);
          }}
        />
      )}
    </>
  );
}

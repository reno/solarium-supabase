"use client";

import {
  useSelectedWalletAccount,
  useWalletAccountTransactionSigner,
} from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ProgressModal } from "@/components/progress-modal";
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
  editionNumber: number | null;
  editionTotal: number | null;
  collectionId: string | null;
  collectionAddress: string | null;
  listing: { id: string; priceLamports: string } | null;
};

export function MyNftCard({
  nft,
  userId,
  href,
}: {
  nft: OwnedNft;
  userId: string;
  href?: string;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <Link href={href ?? `/nft/${nft.id}`} className="flex flex-col">
        <div className="relative aspect-square bg-zinc-100 dark:bg-zinc-900">
          <Image
            src={nft.imageUrl}
            alt={nft.name}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
            unoptimized
          />
        </div>
        <div className="p-4 pb-0">
          <h2 className="font-medium">{nft.name}</h2>
          {nft.listing ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Listed for {lamportsToSol(BigInt(nft.listing.priceLamports))} SOL
            </p>
          ) : (
            <p className="text-sm text-zinc-500">Not listed</p>
          )}
        </div>
      </Link>
      <div className="p-4">
        <OwnedNftControls nft={nft} userId={userId} />
      </div>
    </div>
  );
}

export function OwnedNftControls({
  nft,
  userId,
}: {
  nft: OwnedNft;
  userId: string;
}) {
  const [selectedWalletAccount] = useSelectedWalletAccount();
  if (!selectedWalletAccount) {
    return (
      <p className="text-sm text-zinc-500">
        Connect your wallet to manage this NFT.
      </p>
    );
  }
  return <CardActions account={selectedWalletAccount} nft={nft} userId={userId} />;
}

function CardActions({
  account,
  nft,
  userId,
}: {
  account: UiWalletAccount;
  nft: OwnedNft;
  userId: string;
}) {
  const [price, setPrice] = useState("");
  const [action, setAction] = useState<"list" | "cancel" | null>(null);
  const [phase, setPhase] = useState<"idle" | "active" | "error">("idle");
  const [stage, setStage] = useState<ListStage | CancelStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kitSigner = useWalletAccountTransactionSigner(
    account,
    getSolanaChain()
  );
  const umi = useMemo(() => createUmiForWallet(kitSigner), [kitSigner]);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const busy = phase === "active";

  const run = async (kind: "list" | "cancel", perform: () => Promise<unknown>) => {
    setAction(kind);
    setPhase("active");
    setError(null);
    try {
      await perform();
      setPhase("idle");
      setAction(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {nft.listing ? (
        <button
          disabled={busy}
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          onClick={() =>
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
            )
          }
        >
          {busy && action === "cancel" ? "Cancelling…" : "Cancel listing"}
        </button>
      ) : (
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="decimal"
            placeholder="Price in SOL"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            className="w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
          <button
            disabled={busy || !price.trim()}
            className="shrink-0 rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-300"
            onClick={() =>
              run("list", async () => {
                let priceLamports: bigint;
                try {
                  priceLamports = solToLamports(price);
                } catch {
                  throw new Error(
                    "Enter a valid SOL amount, e.g. 0.5 (up to 9 decimals)."
                  );
                }
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
                  onStage: setStage,
                });
                setPrice("");
              })
            }
          >
            {busy && action === "list" ? "Listing…" : "List"}
          </button>
        </div>
      )}
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

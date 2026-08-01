"use client";

import { useSelectedWalletAccount } from "@solana/react";
import { useWalletAccountTransactionSigner } from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import Image from "next/image";
import { useMemo, useState } from "react";

import { ProgressModal } from "@/components/progress-modal";
import type { ProgressStepDef } from "@/components/progress-steps";
import { MAX_EDITIONS, mintNfts, type MintStage } from "@/lib/mint/mint";
import { explorerAddressUrl, getSolanaChain } from "@/lib/solana/config";
import { createUmiForWallet } from "@/lib/solana/umi";
import { createClient } from "@/lib/supabase/client";

const MINT_STEPS: ProgressStepDef[] = [
  { key: "uploading", label: "Uploading media" },
  { key: "signing", label: "Waiting for your wallet" },
  { key: "sending", label: "Confirming on Solana" },
  { key: "recording", label: "Saving to Solarium" },
];

export function MintForm({ creatorId }: { creatorId: string }) {
  const [selectedWalletAccount] = useSelectedWalletAccount();

  if (!selectedWalletAccount) {
    return (
      <p className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        Connect your wallet (top right) to mint.
      </p>
    );
  }
  return <MintFormInner account={selectedWalletAccount} creatorId={creatorId} />;
}

function MintFormInner({
  account,
  creatorId,
}: {
  account: UiWalletAccount;
  creatorId: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [stage, setStage] = useState<MintStage | null>(null);
  const [phase, setPhase] = useState<"idle" | "active" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string[] | null>(null);

  const kitSigner = useWalletAccountTransactionSigner(
    account,
    getSolanaChain()
  );
  const umi = useMemo(() => createUmiForWallet(kitSigner), [kitSigner]);
  const supabase = useMemo(() => createClient(), []);
  const busy = phase === "active";

  if (minted) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">
          Minted {minted.length} {minted.length === 1 ? "NFT" : "editions"} 🎉
        </h2>
        <ul className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
          {minted.map((address) => (
            <li key={address}>
              <a
                className="font-mono underline-offset-4 hover:underline"
                href={explorerAddressUrl(address)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {address.slice(0, 8)}…{address.slice(-8)}
              </a>
            </li>
          ))}
        </ul>
        <button
          className="self-start rounded-full border border-zinc-300 px-4 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          onClick={() => {
            setMinted(null);
            setFile(null);
            setPreview(null);
            setName("");
            setDescription("");
            setQuantity(1);
          }}
        >
          Mint another
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!file) {
          setError("Choose an image to mint.");
          return;
        }
        setError(null);
        setPhase("active");
        try {
          const result = await mintNfts({
            supabase,
            umi,
            creatorId,
            file,
            fileName: file.name,
            name: name.trim(),
            description: description.trim() || null,
            quantity,
            onStage: setStage,
          });
          setMinted(result.assetAddresses);
          setPhase("idle");
          setStage(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Minting failed.");
          setPhase("error");
        }
      }}
    >
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500">
        {preview ? (
          <Image
            src={preview}
            alt="Preview"
            width={320}
            height={320}
            className="max-h-64 w-auto rounded-lg object-contain"
            unoptimized
          />
        ) : (
          <span>Click to choose an image</span>
        )}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            setFile(chosen);
            if (chosen) setPreview(URL.createObjectURL(chosen));
          }}
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium">
        Name
        <input
          type="text"
          required
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="My artwork"
          className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium">
        Description <span className="font-normal text-zinc-500">(optional)</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          maxLength={2000}
          className="resize-none rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium">
        Editions
        <input
          type="number"
          min={1}
          max={MAX_EDITIONS}
          value={quantity}
          onChange={(event) =>
            setQuantity(
              Math.min(
                MAX_EDITIONS,
                Math.max(1, Number(event.target.value) || 1)
              )
            )
          }
          className="w-24 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-normal outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <span className="font-normal text-zinc-500">
          Mint up to {MAX_EDITIONS} numbered copies of this artwork.
        </span>
      </label>

      {error && phase !== "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-300"
      >
        {busy ? "Minting…" : quantity > 1 ? `Mint ${quantity} editions` : "Mint"}
      </button>

      {phase !== "idle" && (
        <ProgressModal
          title="Minting NFT"
          steps={MINT_STEPS}
          currentKey={stage}
          status={phase === "error" ? "error" : "active"}
          errorMessage={error}
          onClose={() => {
            setPhase("idle");
            setStage(null);
          }}
        />
      )}
    </form>
  );
}

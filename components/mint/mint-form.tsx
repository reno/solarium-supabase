"use client";

import { useSelectedWalletAccount } from "@solana/react";
import { useWalletAccountTransactionSigner } from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button, Input } from "@/components/design";
import { ProgressModal } from "@/components/progress-modal";
import { useToast } from "@/components/toast/toast-provider";
import type { ProgressStepDef } from "@/components/progress-steps";
import { MAX_SUPPLY, mintNfts, type MintStage } from "@/lib/mint/mint";
import { explorerAddressUrl, getSolanaChain } from "@/lib/solana/config";
import { createUmiForWallet } from "@/lib/solana/umi";
import { createClient } from "@/lib/supabase/client";

const MINT_STEPS: ProgressStepDef[] = [
  { key: "uploading", label: "Uploading media" },
  { key: "signing", label: "Waiting for your wallet" },
  { key: "sending", label: "Confirming on Solana" },
  { key: "recording", label: "Saving to Solarium" },
];

const FIELD_LABEL: React.CSSProperties = {
  display: "block",
  font: "var(--type-label)",
  fontSize: "var(--text-2xs)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-label)",
  color: "var(--text-tertiary)",
  marginBottom: "var(--space-4)",
};
const TEXTAREA: React.CSSProperties = {
  width: "100%",
  padding: "var(--space-5)",
  background: "var(--surface-inset)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-control)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-md)",
  resize: "vertical",
};

export function MintForm({ creatorId }: { creatorId: string }) {
  const [selectedWalletAccount] = useSelectedWalletAccount();

  if (!selectedWalletAccount) {
    return (
      <p style={{ margin: 0, padding: "var(--space-7)", borderRadius: "var(--radius-card)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>
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
  const [mintedCollectionId, setMintedCollectionId] = useState<string | null>(null);

  const kitSigner = useWalletAccountTransactionSigner(
    account,
    getSolanaChain()
  );
  const umi = useMemo(() => createUmiForWallet(kitSigner), [kitSigner]);
  const supabase = useMemo(() => createClient(), []);
  const { showToast } = useToast();
  const busy = phase === "active";

  if (minted) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", padding: "var(--space-8)", borderRadius: "var(--radius-card)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)" }}>
        <h2 style={{ font: "var(--type-h3)", color: "var(--text-primary)", margin: 0 }}>
          Minted {minted.length} {minted.length === 1 ? "item" : "items"}
        </h2>
        <ul style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", margin: 0, padding: 0, listStyle: "none" }}>
          {minted.map((address) => (
            <li key={address}>
              <a style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-link)" }} href={explorerAddressUrl(address)} target="_blank" rel="noopener noreferrer">
                {address.slice(0, 8)}…{address.slice(-8)}
              </a>
            </li>
          ))}
        </ul>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
          {mintedCollectionId
            ? "Next: open your drop to add mint phases and list these items for sale."
            : "Next: list these items for sale from your portfolio."}
        </p>
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <Link href={mintedCollectionId ? `/launchpad/${mintedCollectionId}` : "/collection"} style={{ textDecoration: "none" }}>
            <Button variant="primary" iconRight="arrow-right">
              {mintedCollectionId ? "Set up drop & list items" : "View in portfolio"}
            </Button>
          </Link>
          <Button
            variant="secondary"
            onClick={() => {
              setMinted(null);
              setMintedCollectionId(null);
              setFile(null);
              setPreview(null);
              setName("");
              setDescription("");
              setQuantity(1);
            }}
          >
            Mint another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}
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
          setMintedCollectionId(result.collectionId);
          setPhase("idle");
          setStage(null);
          showToast({ type: "success", title: "Mint complete", message: `${result.assetAddresses.length} × ${name.trim() || "item"}` });
        } catch (e) {
          setError(e instanceof Error ? e.message : "Minting failed.");
          setPhase("error");
        }
      }}
    >
      <label
        style={{
          display: "flex",
          cursor: "pointer",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-4)",
          padding: "var(--space-9)",
          borderRadius: "var(--radius-card)",
          border: "1px dashed var(--border-strong)",
          background: "var(--surface-inset)",
          fontSize: "var(--text-md)",
          color: "var(--text-tertiary)",
        }}
      >
        {preview ? (
          <Image src={preview} alt="Preview" width={320} height={320} style={{ maxHeight: 256, width: "auto", borderRadius: "var(--radius-media)", objectFit: "contain" }} unoptimized />
        ) : (
          <span>Click to choose an image</span>
        )}
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            setFile(chosen);
            if (chosen) setPreview(URL.createObjectURL(chosen));
          }}
        />
      </label>

      <div>
        <label style={FIELD_LABEL}>Name</label>
        <Input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="My artwork" />
      </div>

      <div>
        <label style={FIELD_LABEL}>Description (optional)</label>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} style={TEXTAREA} />
      </div>

      <div>
        <label style={FIELD_LABEL}>Supply</label>
        <Input
          type="number"
          min={1}
          max={MAX_SUPPLY}
          numeric
          value={quantity}
          onChange={(event) => setQuantity(Math.min(MAX_SUPPLY, Math.max(1, Number(event.target.value) || 1)))}
          containerStyle={{ width: 120 }}
        />
        <span style={{ display: "block", marginTop: "var(--space-4)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
          Create up to {MAX_SUPPLY} items in one collection.
        </span>
      </div>

      {error && phase !== "error" && <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--price-down)" }}>{error}</p>}

      <div>
        <Button type="submit" variant="primary" icon="sparkle" loading={busy} disabled={busy}>
          {quantity > 1 ? `Mint ${quantity} items` : "Mint"}
        </Button>
      </div>

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

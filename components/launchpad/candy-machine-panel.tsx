"use client";

import { useSelectedWalletAccount, useWalletAccountTransactionSigner } from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge, Button, Card, Icon, Input } from "@/components/design";
import { useToast } from "@/components/toast/toast-provider";
import { TxFlow } from "@/components/tx/tx-flow";
import {
  deployCandyMachine,
  estimateDeployCost,
  readDropManifest,
  syncCandyGuards,
  MAX_DROP_SUPPLY,
  type CandyMachineRow,
} from "@/lib/launchpad/candy-machine";
import type { PhaseInput } from "@/lib/launchpad/candy-guards";
import { explorerAddressUrl, explorerTxUrl, getSolanaChain } from "@/lib/solana/config";
import { useSolBalance } from "@/lib/solana/use-balance";
import { createUmiForWallet } from "@/lib/solana/umi";
import { createClient } from "@/lib/supabase/client";

export type SerializedPhase = Omit<PhaseInput, "priceLamports"> & { priceLamports: string; groupLabel: string | null };

export function deserializePhases(phases: SerializedPhase[]): PhaseInput[] {
  return phases.map((p) => ({ ...p, priceLamports: BigInt(p.priceLamports) }));
}

const DEPLOY_STAGES = [
  { key: "metadata", label: "Uploading item metadata" },
  { key: "collection", label: "Creating the collection" },
  { key: "machine", label: "Creating the candy machine" },
  { key: "items", label: "Loading items" },
  { key: "recording", label: "Recording the drop" },
];

const MONO_2XS: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-2xs)",
  color: "var(--text-tertiary)",
};

export function CandyMachinePanel(props: {
  collectionId: string;
  collectionName: string;
  description: string | null;
  collectionAddress: string | null;
  creatorId: string;
  creatorWallet: string | null;
  imageUrl: string | null;
  revealAt: string | null;
  phases: SerializedPhase[];
  allowlist: string[];
  machine: CandyMachineRow | null;
  hasMintedItems: boolean;
  defaultSupply?: string;
}) {
  const [account] = useSelectedWalletAccount();
  if (!account) {
    return (
      <Shell machine={props.machine}>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-tertiary)" }}>
          Connect the wallet that created this collection to manage its candy machine.
        </p>
      </Shell>
    );
  }
  return <Inner {...props} account={account} />;
}

function Shell({ machine, children }: { machine: CandyMachineRow | null; children: React.ReactNode }) {
  return (
    <Card padding="var(--space-8)" style={{ maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
        <span className="sol-label" style={{ color: "var(--text-primary)" }}>
          On-chain mint
        </span>
        {machine ? <Badge tone="live">Enforced</Badge> : <Badge tone="neutral">Not deployed</Badge>}
      </div>
      {children}
    </Card>
  );
}

function Inner({
  account,
  collectionId,
  collectionName,
  description,
  collectionAddress,
  creatorId,
  creatorWallet,
  imageUrl,
  revealAt,
  phases,
  allowlist,
  machine,
  hasMintedItems,
  defaultSupply,
}: Parameters<typeof CandyMachinePanel>[0] & { account: UiWalletAccount }) {
  const kitSigner = useWalletAccountTransactionSigner(account, getSolanaChain());
  const umi = useMemo(() => createUmiForWallet(kitSigner), [kitSigner]);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();
  const balanceLamports = useSolBalance(account.address);

  const [supply, setSupply] = useState(defaultSupply ?? "");
  const [flowOpen, setFlowOpen] = useState(false);
  const [costLamports, setCostLamports] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manifestSupply, setManifestSupply] = useState<number | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [manifestChecked, setManifestChecked] = useState(false);

  // A drop created through the wizard has a manifest, and it — not a typed number — decides how
  // many items the machine is sized for. Drops from before per-item uploads have none, and fall
  // back to the supply field.
  useEffect(() => {
    let cancelled = false;
    readDropManifest(supabase, creatorId, collectionId)
      .then((manifest) => {
        if (!cancelled) setManifestSupply(manifest?.supply ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setManifestError(e instanceof Error ? e.message : "Could not read this drop's items.");
      })
      .finally(() => {
        if (!cancelled) setManifestChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, creatorId, collectionId]);

  const parsedSupply = Number(supply);
  const typedSupplyValid = Number.isInteger(parsedSupply) && parsedSupply >= 1 && parsedSupply <= MAX_DROP_SUPPLY;
  const supplyValid = manifestSupply != null || typedSupplyValid;
  const remaining = machine ? machine.itemsAvailable - machine.itemsLoaded : 0;
  const targetSupply = machine ? machine.itemsAvailable : (manifestSupply ?? (typedSupplyValid ? parsedSupply : 0));
  const deployedSupply = targetSupply;

  const openDeploy = async () => {
    setError(null);
    if (!machine && !supplyValid) {
      setError(`Enter a supply between 1 and ${MAX_DROP_SUPPLY}.`);
      return;
    }
    if (!creatorWallet) {
      setError("Your profile has no wallet address.");
      return;
    }
    setBusy(true);
    try {
      const cost = machine
        ? 0n
        : await estimateDeployCost(umi, {
            supply: targetSupply,
            collectionName,
            needsCollection: !collectionAddress,
          });
      setCostLamports(cost);
      setFlowOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not estimate the deploy cost.");
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    if (!machine || !creatorWallet) return;
    setBusy(true);
    setError(null);
    try {
      await syncCandyGuards({
        supabase,
        umi,
        candyMachineAddress: machine.candyMachineAddress,
        creatorWallet,
        phases: deserializePhases(phases),
        allowlist,
      });
      showToast({ type: "success", title: "Guards synced", message: "The chain now enforces your current phases." });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setBusy(false);
    }
  };

  const costSol = costLamports != null ? Number(costLamports) / 1e9 : 0;

  return (
    <Shell machine={machine}>
      {machine ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <Row label="Candy machine" value={machine.candyMachineAddress} href={explorerAddressUrl(machine.candyMachineAddress)} />
          <Row label="Items loaded" value={`${machine.itemsLoaded} / ${machine.itemsAvailable}`} />
          <Row label="Minted" value={`${machine.itemsRedeemed} / ${machine.itemsAvailable}`} />
          {remaining > 0 && (
            <div
              style={{
                marginTop: "var(--space-3)",
                padding: "var(--space-6)",
                borderRadius: "var(--radius-card)",
                border: "1px solid var(--border-subtle)",
                background: "var(--surface-inset)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-4)" }}>
                <Icon name="alert-circle" size={14} color="var(--accent)" style={{ position: "relative", top: 2 }} />
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                  {remaining} item{remaining === 1 ? "" : "s"} still need loading — nobody can mint past what&apos;s
                  loaded.
                </span>
              </div>
              <div style={{ marginTop: "var(--space-5)" }}>
                <Button variant="primary" icon="upload" loading={busy} disabled={busy} onClick={openDeploy}>
                  Finish loading
                </Button>
              </div>
            </div>
          )}
          <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-6)", borderTop: "1px solid var(--border-subtle)" }}>
            <Button variant="secondary" icon="refresh-cw" loading={busy} disabled={busy} onClick={sync}>
              Sync phases to chain
            </Button>
            <p style={{ margin: "var(--space-4) 0 0", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", textWrap: "pretty" }}>
              Phase edits and new allowlist wallets only take effect on chain once you sync — until then the
              guards keep enforcing what you deployed.
            </p>
          </div>
        </div>
      ) : (
        <>
          <p style={{ margin: "0 0 var(--space-6)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            Deploy a candy machine and the chain enforces your phases: price, start and end, per-wallet limit and
            allowlist all become guards. Nothing is pre-minted — buyers mint straight from the machine.
          </p>
          {hasMintedItems && (
            <p style={{ margin: "0 0 var(--space-6)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
              This collection already has minted items. A candy machine adds new ones on top of them, and the mint
              panel switches to minting from the machine rather than selling your listings.
            </p>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-6)" }}>
            <div style={{ flex: 1, maxWidth: 260 }}>
              <label
                style={{
                  display: "block",
                  font: "var(--type-label)",
                  fontSize: "var(--text-2xs)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--tracking-label)",
                  color: "var(--text-tertiary)",
                  marginBottom: "var(--space-3)",
                }}
              >
                Supply
              </label>
              {!manifestChecked ? (
                <div style={{ display: "flex", alignItems: "center", height: "var(--control-h-md)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  Counting your items…
                </div>
              ) : manifestSupply != null ? (
                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", height: "var(--control-h-md)" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", color: "var(--text-primary)" }}>
                    {manifestSupply}
                  </span>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                    item{manifestSupply === 1 ? "" : "s"} uploaded
                  </span>
                </div>
              ) : (
                <Input numeric placeholder="100" value={supply} onChange={(e) => setSupply(e.target.value)} />
              )}
            </div>
            <Button
              variant="primary"
              icon="rocket"
              loading={busy}
              disabled={busy || phases.length === 0 || !manifestChecked}
              onClick={openDeploy}
            >
              Deploy candy machine
            </Button>
          </div>
          {manifestSupply != null && (
            <p style={{ margin: "var(--space-5) 0 0", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", textWrap: "pretty" }}>
              Supply comes from the artwork you uploaded — each item keeps its own image and traits, and the
              machine hands them out in random order.
            </p>
          )}
          {manifestError && (
            <p style={{ margin: "var(--space-5) 0 0", fontSize: "var(--text-2xs)", color: "var(--price-down)" }}>
              {manifestError}
            </p>
          )}
          {phases.length === 0 && (
            <p style={{ margin: "var(--space-5) 0 0", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
              Add at least one phase first — the guards are built from your phases.
            </p>
          )}
        </>
      )}

      {error && (
        <p style={{ margin: "var(--space-6) 0 0", fontSize: "var(--text-xs)", color: "var(--price-down)" }}>{error}</p>
      )}

      {flowOpen && creatorWallet && (
        <TxFlow
          open
          onClose={() => setFlowOpen(false)}
          onDone={() => {
            showToast({
              type: "success",
              title: machine ? "Items loaded" : "Candy machine deployed",
              message: collectionName,
            });
            router.refresh();
          }}
          config={{
            title: machine ? "Finish loading items" : "Deploy candy machine",
            approveLabel: machine ? "Approve & load" : "Approve & deploy",
            lines: [
              { label: "Supply", value: String(deployedSupply) },
              { label: "Phases → guard groups", value: String(phases.length) },
              ...(allowlist.length ? [{ label: "Allowlist wallets", value: String(allowlist.length), muted: true }] : []),
              { label: "Wallet approvals", value: machine ? "1 or more" : "3 or more", muted: true },
            ],
            total: { label: machine ? "Fees" : "Rent + fees", value: `~${costSol.toFixed(4)} SOL` },
            balanceSol: balanceLamports != null ? Number(balanceLamports) / 1e9 : null,
            needSol: costSol,
            stages: DEPLOY_STAGES,
            perform: async (onStage) => {
              if (!imageUrl) throw new Error("This collection has no artwork to mint from.");
              const result = await deployCandyMachine({
                supabase,
                umi,
                collectionId,
                collectionName,
                description,
                collectionAddress,
                creatorId,
                creatorWallet,
                imageUrl,
                revealAt,
                supply: targetSupply,
                phases: deserializePhases(phases),
                allowlist,
                existing: machine,
                onStage: (stage) => onStage(stage),
              });
              return {
                signature: result.signatures[result.signatures.length - 1],
                summary: `${result.itemsLoaded} of ${targetSupply} items loaded.`,
              };
            },
            successTitle: machine ? "Items loaded" : "Drop is on chain",
            explorerUrl: explorerTxUrl,
            errorHint:
              "Anything that already landed is saved — reopening this panel picks up where it stopped rather than starting over.",
          }}
        />
      )}
    </Shell>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-6)" }}>
      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...MONO_2XS, color: "var(--text-link)", textDecoration: "none", wordBreak: "break-all", textAlign: "right" }}
        >
          {value}
        </a>
      ) : (
        <span style={{ ...MONO_2XS, color: "var(--text-primary)" }}>{value}</span>
      )}
    </div>
  );
}

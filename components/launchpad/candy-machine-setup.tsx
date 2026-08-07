"use client";

import { useSelectedWalletAccount, useWalletAccountTransactionSigner } from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, Card, Icon, Input } from "@/components/design";
import { useToast } from "@/components/toast/toast-provider";
import {
  candyMachineAccountSize,
  deployCandyMachine,
  deriveConfigLineSettings,
  uploadConfigLines,
  type ConfigLineItem,
  type DeployStage,
  type PhaseGuardInput,
} from "@/lib/launchpad/candy-machine";
import { explorerAddressUrl, getSolanaChain } from "@/lib/solana/config";
import { createUmiForWallet } from "@/lib/solana/umi";
import { createClient } from "@/lib/supabase/client";

/**
 * Deploy and load a Candy Machine for a drop.
 *
 * The listing-backed path asks the creator to pre-mint the supply into their own wallet and list
 * every item; this replaces both steps with one deployment. Nothing is minted until a buyer mints
 * it, and the phases the creator already configured become the on-chain guards — so the window,
 * the price, the per-wallet limit and the allowlist stop being advisory.
 *
 * Two states, because they cost different things and fail differently:
 *
 *   not deployed  — quote the rent, then create the collection + machine + guards and start
 *                   loading the items.
 *   loading       — some config lines are written and some aren't. A machine in this state cannot
 *                   mint at all (the chain rejects an unwritten line), so this is a pause and not
 *                   a broken drop; "Resume" continues from `itemsLoaded`.
 */

const LAMPORTS_PER_SOL = 1_000_000_000;
// Solana's rent-exempt minimum: a per-account base plus a per-byte rate, over two years.
// Only used to quote the cost before the creator signs — the chain charges the real figure.
const RENT_LAMPORTS_PER_BYTE_YEAR = 3480;
const RENT_ACCOUNT_OVERHEAD_BYTES = 128;

function rentForBytes(bytes: number): number {
  return ((bytes + RENT_ACCOUNT_OVERHEAD_BYTES) * RENT_LAMPORTS_PER_BYTE_YEAR * 2) / LAMPORTS_PER_SOL;
}

const FIELD_LABEL: React.CSSProperties = {
  display: "block",
  font: "var(--type-label)",
  fontSize: "var(--text-2xs)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-label)",
  color: "var(--text-tertiary)",
  marginBottom: "var(--space-3)",
};

const MONO_TEXTAREA: React.CSSProperties = {
  width: "100%",
  padding: "var(--space-5)",
  background: "var(--surface-inset)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-control)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-xs)",
  resize: "vertical",
};

export type CandyMachineState = {
  candyMachineAddress: string | null;
  itemsAvailable: number;
  itemsLoaded: number;
};

export type CandyMachineSetupProps = {
  collectionId: string;
  collectionName: string;
  collectionAddress: string | null;
  royaltyBps: number;
  feeBps: number;
  treasuryWallet: string | null;
  phases: PhaseGuardInput[];
  allowlist: string[];
  state: CandyMachineState;
};

/**
 * Parse the creator's item list.
 *
 * Two shapes, because a drop can be either. A JSON array of `{name, uri}` is the real generative
 * case — distinct art and traits per item. The base-URI + supply form covers the common case where
 * the metadata files are already numbered on Arweave/IPFS, and saves pasting 5000 lines.
 */
export function buildItems(args: {
  json: string;
  baseUri: string;
  supply: number;
  collectionName: string;
}): ConfigLineItem[] {
  const trimmed = args.json.trim();
  if (trimmed) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Item list is not valid JSON.");
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("Item list must be a non-empty JSON array of { name, uri }.");
    }
    return parsed.map((raw, i) => {
      const item = raw as { name?: unknown; uri?: unknown };
      if (typeof item.name !== "string" || typeof item.uri !== "string" || !item.name || !item.uri) {
        throw new Error(`Item ${i + 1} needs both a "name" and a "uri".`);
      }
      return { name: item.name, uri: item.uri };
    });
  }

  if (!args.baseUri.trim()) throw new Error("Paste an item list, or give a base metadata URI.");
  if (!Number.isInteger(args.supply) || args.supply < 1) {
    throw new Error("Supply must be a whole number of at least 1.");
  }
  const base = args.baseUri.trim().replace(/\/+$/, "");
  return Array.from({ length: args.supply }, (_, i) => ({
    name: `${args.collectionName} #${i + 1}`,
    uri: `${base}/${i + 1}.json`,
  }));
}

const STAGE_LABEL: Record<DeployStage, string> = {
  collection: "Creating the collection…",
  creating: "Creating the candy machine and guards…",
  recording: "Recording the deployment…",
  uploading: "Writing items on chain…",
  done: "Done.",
};

export function CandyMachineSetup(props: CandyMachineSetupProps) {
  const [account] = useSelectedWalletAccount();
  if (!account) {
    return (
      <Card padding="var(--space-8)">
        <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
          Connect your wallet to deploy this drop on chain.
        </p>
      </Card>
    );
  }
  return <Inner {...props} account={account} />;
}

function Inner({ account, ...p }: CandyMachineSetupProps & { account: UiWalletAccount }) {
  const kitSigner = useWalletAccountTransactionSigner(account, getSolanaChain());
  const umi = useMemo(() => createUmiForWallet(kitSigner), [kitSigner]);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { showToast } = useToast();

  const [json, setJson] = useState("");
  const [baseUri, setBaseUri] = useState("");
  const [supply, setSupply] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deployed = p.state.candyMachineAddress !== null;
  const remaining = p.state.itemsAvailable - p.state.itemsLoaded;

  // Quote the rent before the creator signs. Only meaningful pre-deploy, and only once the items
  // are known — the whole bill is the config-line area, which is sized from the items themselves.
  const quote = useMemo(() => {
    if (deployed) return null;
    try {
      const items = buildItems({
        json,
        baseUri,
        supply: Number(supply),
        collectionName: p.collectionName,
      });
      const settings = deriveConfigLineSettings(items);
      return {
        count: items.length,
        sol: rentForBytes(candyMachineAccountSize(items.length, settings)),
      };
    } catch {
      return null;
    }
  }, [deployed, json, baseUri, supply, p.collectionName]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const deploy = () =>
    run(async () => {
      if (p.phases.length === 0) {
        throw new Error("Add at least one mint phase first — phases become the on-chain guards.");
      }
      const items = buildItems({
        json,
        baseUri,
        supply: Number(supply),
        collectionName: p.collectionName,
      });
      const result = await deployCandyMachine({
        supabase,
        umi,
        collectionId: p.collectionId,
        collectionName: p.collectionName,
        collectionAddress: p.collectionAddress,
        creatorWallet: account.address,
        treasuryWallet: p.treasuryWallet,
        royaltyBps: p.royaltyBps,
        feeBps: p.feeBps,
        phases: p.phases,
        allowlist: p.allowlist,
        items,
        onStage: (stage, done) =>
          setProgress(
            stage === "uploading" && done
              ? `Writing items on chain… ${done.done} / ${done.total}`
              : STAGE_LABEL[stage]
          ),
      });
      showToast({
        type: "success",
        title: "Drop deployed",
        message: `${result.itemsLoaded} items loaded on chain.`,
      });
    });

  const resume = () =>
    run(async () => {
      const items = buildItems({
        json,
        baseUri,
        supply: Number(supply) || p.state.itemsAvailable,
        collectionName: p.collectionName,
      });
      if (items.length !== p.state.itemsAvailable) {
        // The machine reserved space for exactly this many lines; a different list would write
        // the wrong items into the remaining slots.
        throw new Error(
          `This machine was created for ${p.state.itemsAvailable} items, but the list has ${items.length}. Use the same list you deployed with.`
        );
      }
      const loaded = await uploadConfigLines({
        supabase,
        umi,
        collectionId: p.collectionId,
        candyMachine: p.state.candyMachineAddress!,
        items,
        startIndex: p.state.itemsLoaded,
        onProgress: (done, total) => setProgress(`Writing items on chain… ${done} / ${total}`),
      });
      showToast({
        type: "success",
        title: loaded >= p.state.itemsAvailable ? "All items loaded" : "Upload paused",
        message: `${loaded} / ${p.state.itemsAvailable} items on chain.`,
      });
    });

  const itemFields = (
    <>
      <div style={{ marginBottom: "var(--space-7)" }}>
        <label style={FIELD_LABEL}>Item list (JSON array of {"{ name, uri }"})</label>
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={4}
          placeholder='[{ "name": "Solarium #1", "uri": "https://…/1.json" }]'
          style={MONO_TEXTAREA}
        />
        <p style={{ margin: "var(--space-3) 0 0", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
          One entry per item — this is what makes the drop generative rather than numbered copies.
          Leave empty to generate the list from a numbered base URI instead.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: "var(--space-6)" }}>
        <div>
          <label style={FIELD_LABEL}>Base metadata URI</label>
          <Input
            placeholder="https://arweave.net/…"
            value={baseUri}
            onChange={(e) => setBaseUri(e.target.value)}
            disabled={json.trim().length > 0}
          />
        </div>
        <div>
          <label style={FIELD_LABEL}>Supply</label>
          <Input
            numeric
            placeholder="5000"
            value={supply}
            onChange={(e) => setSupply(e.target.value)}
            disabled={json.trim().length > 0}
          />
        </div>
      </div>
    </>
  );

  return (
    <Card padding="var(--space-8)">
      {deployed ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="sol-label">On-chain drop</span>
            <a
              href={explorerAddressUrl(p.state.candyMachineAddress!)}
              target="_blank"
              rel="noreferrer"
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-link)" }}
            >
              Candy machine ↗
            </a>
          </div>

          <div style={{ height: 6, background: "var(--surface-3)", borderRadius: 999, marginTop: "var(--space-6)", overflow: "hidden" }}>
            <div
              style={{
                width: `${p.state.itemsAvailable ? (p.state.itemsLoaded / p.state.itemsAvailable) * 100 : 0}%`,
                height: "100%",
                background: remaining > 0 ? "var(--accent)" : "var(--price-up)",
              }}
            />
          </div>
          <div style={{ marginTop: "var(--space-4)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
            {p.state.itemsLoaded} / {p.state.itemsAvailable} items loaded
          </div>

          {remaining > 0 ? (
            <>
              <div style={{ marginTop: "var(--space-7)", display: "flex", alignItems: "flex-start", gap: "var(--space-4)" }}>
                <Icon name="info" size={14} color="var(--text-tertiary)" style={{ position: "relative", top: 2 }} />
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                  {remaining} item{remaining === 1 ? "" : "s"} still to write. Nobody can mint until
                  they all are — paste the same list you deployed with and resume.
                </span>
              </div>
              <div style={{ marginTop: "var(--space-7)" }}>{itemFields}</div>
              <div style={{ marginTop: "var(--space-7)" }}>
                <Button variant="primary" icon="upload" loading={busy} disabled={busy} onClick={resume}>
                  Resume upload
                </Button>
              </div>
            </>
          ) : (
            <p style={{ margin: "var(--space-6) 0 0", fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
              Every item is on chain. The guards enforce your phases now — buyers mint straight from
              the candy machine, and nothing needs listing.
            </p>
          )}
        </>
      ) : (
        <>
          <span className="sol-label">Deploy on chain</span>
          <p style={{ margin: "var(--space-4) 0 var(--space-7)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
            Deploying turns your phases into on-chain guards: the chain — not the app — enforces the
            mint window, the price, the per-wallet limit and the allowlist. Nothing is minted until
            someone mints it, so you don&apos;t pre-mint or list the supply.
          </p>

          {itemFields}

          {quote && (
            <div style={{ marginTop: "var(--space-7)", padding: "var(--space-6)", borderRadius: "var(--radius-card)", border: "1px solid var(--border-subtle)", background: "var(--surface-inset)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)" }}>
                <span style={{ color: "var(--text-secondary)" }}>{quote.count} items · account rent</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  ≈ {quote.sol.toFixed(4)} SOL
                </span>
              </div>
              <p style={{ margin: "var(--space-4) 0 0", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", textWrap: "pretty" }}>
                Rent is a deposit, not a fee — it is reclaimable once the drop has minted out. Plus
                network fees for each transaction; a large list takes several wallet approvals.
              </p>
            </div>
          )}

          <div style={{ marginTop: "var(--space-7)" }}>
            <Button variant="primary" icon="sparkle" loading={busy} disabled={busy} onClick={deploy}>
              Deploy candy machine
            </Button>
          </div>
        </>
      )}

      {progress && (
        <p style={{ margin: "var(--space-6) 0 0", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
          {progress}
        </p>
      )}
      {error && (
        <p style={{ margin: "var(--space-6) 0 0", fontSize: "var(--text-xs)", color: "var(--price-down)", textWrap: "pretty" }}>
          {error}
        </p>
      )}
    </Card>
  );
}

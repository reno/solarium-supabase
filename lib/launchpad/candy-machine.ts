import { createCollection as createCoreCollection, ruleSet } from "@metaplex-foundation/mpl-core";
import {
  addConfigLines,
  create as createCandyMachine,
  fetchCandyMachine,
  getMerkleProof,
  getMerkleRoot,
  mintV1,
  route,
  type DefaultGuardSetArgs,
  type DefaultGuardSetMintArgs,
} from "@metaplex-foundation/mpl-core-candy-machine";
import {
  generateSigner,
  publicKey,
  some,
  dateTime,
  type OptionOrNullable,
  type Signer,
  type TransactionBuilder,
  type Umi,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { recordCandyMachineMint } from "@/lib/launchpad/record-mint";
import { withRpcRetry } from "@/lib/solana/retry";

/**
 * Candy-machine-backed launches.
 *
 * The listing-backed launchpad (see `lib/launchpad/launchpad.ts` and the `settle` function)
 * sells creator-pre-minted items, and enforces the phase window / per-wallet limit / allowlist
 * in the app — advisory only, as `20260802153213_launchpad_phases.sql` admits. Here the drop is
 * a Metaplex Core Candy Machine wrapped in a Candy Guard, so the *chain* enforces all of it and
 * the buyer's own wallet mints. Nothing is pre-minted and no settlement authority is in the path.
 *
 * The mapping from this app's model onto candy guards:
 *
 *   mint_phases row        → one Candy Guard *group* (labelled g0, g1, … — see `guardLabel`)
 *   phase price            → solPayment guard, paid to the creator
 *   phase starts_at/ends_at→ startDate / endDate guards
 *   phase per_wallet_limit → mintLimit guard
 *   phase allowlist_only   → allowList guard over a merkle root of `launchpad_allowlist`
 *   marketplace fee        → solFixedFee guard, paid to the platform treasury
 *   collection royalty_bps → Core Royalties plugin on the collection (a plugin, not a guard)
 *
 * Guard *groups* are all-or-nothing per mint: the minter names the group, and the chain applies
 * exactly that group's guards. So a phase that hasn't opened yet cannot be minted from even if
 * the client asks for it — startDate rejects the transaction.
 */

/** Fixed 6-byte field on chain, so a label is a generated key, not the phase's name. */
export function guardLabel(position: number): string {
  return `g${position}`;
}

export type PhaseGuardInput = {
  id: string;
  position: number;
  priceLamports: bigint;
  startsAt: string;
  endsAt: string | null;
  perWalletLimit: number | null;
  allowlistOnly: boolean;
};

export type GuardGroup = {
  label: string;
  phaseId: string;
  guards: Partial<DefaultGuardSetArgs>;
};

/**
 * Guard groups for a drop's phases, in phase order.
 *
 * `mintLimit` ids must be unique per candy machine (each id is its own on-chain counter PDA), so
 * a phase's position doubles as its counter id — two phases with a limit of 2 each then really
 * mean "2 in the allowlist phase and 2 more in public", which is what the phase list shows.
 *
 * `allowlistOnly` phases get their merkle root here; wallets come from `launchpad_allowlist`. An
 * allowlist phase with no wallets still gets a guard (an empty root nobody can prove against)
 * rather than silently becoming a public phase.
 */
export function phasesToGuardGroups({
  phases,
  creatorWallet,
  treasuryWallet,
  allowlist,
  feeBps,
}: {
  phases: PhaseGuardInput[];
  creatorWallet: string;
  treasuryWallet: string | null;
  allowlist: string[];
  feeBps: number;
}): GuardGroup[] {
  return [...phases]
    .sort((a, b) => a.position - b.position)
    .map((phase) => {
      const guards: Partial<DefaultGuardSetArgs> = {
        solPayment: some({
          lamports: { basisPoints: phase.priceLamports, identifier: "SOL", decimals: 9 },
          destination: publicKey(creatorWallet),
        }),
        startDate: some({ date: dateTime(phase.startsAt) }),
      };
      if (phase.endsAt) {
        guards.endDate = some({ date: dateTime(phase.endsAt) });
      }
      if (phase.perWalletLimit != null) {
        guards.mintLimit = some({ id: phase.position, limit: phase.perWalletLimit });
      }
      if (phase.allowlistOnly) {
        guards.allowList = some({ merkleRoot: getMerkleRoot(allowlist) });
      }
      // The platform fee rides along as a second, fixed SOL leg. Guards take fixed lamports, not
      // a rate, so it is the fee on *this phase's* price, resolved when the drop is deployed.
      const fee = (phase.priceLamports * BigInt(feeBps)) / 10000n;
      if (treasuryWallet && fee > 0n) {
        guards.solFixedFee = some({
          lamports: { basisPoints: fee, identifier: "SOL", decimals: 9 },
          destination: publicKey(treasuryWallet),
        });
      }
      return { label: guardLabel(phase.position), phaseId: phase.id, guards };
    });
}

export type ConfigLineItem = { name: string; uri: string };

export type ConfigLineSettings = {
  prefixName: string;
  nameLength: number;
  prefixUri: string;
  uriLength: number;
  isSequential: boolean;
};

/** Longest shared leading substring, in bytes-safe code units (names/uris here are ASCII). */
function commonPrefix(values: string[]): string {
  if (values.length === 0) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (prefix === "") break;
  }
  return prefix;
}

/**
 * Size the candy machine's config-line area from the items that will actually go in it.
 *
 * This is the whole rent bill: the account reserves `itemsAvailable × (nameLength + uriLength)`
 * bytes up front, so storing the shared part of every name/uri once as a prefix is the difference
 * between a cheap drop and an expensive one. A 5000-item drop whose items all share one metadata
 * URI costs a few thousandths of a SOL here; sized naively at 32 + 200 bytes per line it would
 * cost several SOL. Rent is reclaimable with `deleteCandyMachine` once the drop has minted out.
 */
export function deriveConfigLineSettings(items: ConfigLineItem[]): ConfigLineSettings {
  const names = items.map((i) => i.name);
  const uris = items.map((i) => i.uri);
  const prefixName = commonPrefix(names);
  const prefixUri = commonPrefix(uris);
  const lengthAfter = (values: string[], prefix: string) =>
    values.reduce((max, value) => Math.max(max, value.length - prefix.length), 0);
  return {
    prefixName,
    nameLength: lengthAfter(names, prefixName),
    prefixUri,
    uriLength: lengthAfter(uris, prefixUri),
    isSequential: false,
  };
}

/** What each config line stores, given the settings — the prefix is written once, not per line. */
export function stripPrefixes(
  items: ConfigLineItem[],
  settings: ConfigLineSettings
): ConfigLineItem[] {
  return items.map((item) => ({
    name: item.name.slice(settings.prefixName.length),
    uri: item.uri.slice(settings.prefixUri.length),
  }));
}

/**
 * Bytes the candy machine account occupies — what `deriveConfigLineSettings` is optimising, and
 * what the setup UI quotes to the creator before they sign. Mirrors the on-chain layout: a fixed
 * header, then the config lines, then two bitmaps (which lines are written, and the mint order).
 */
export function candyMachineAccountSize(
  itemsAvailable: number,
  settings: ConfigLineSettings
): number {
  const HEADER = 8 + 8 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 4 + 4 + 200;
  const configLines = itemsAvailable * (settings.nameLength + settings.uriLength);
  const bitmaps = Math.ceil(itemsAvailable / 8) + itemsAvailable * 4;
  return HEADER + settings.prefixName.length + settings.prefixUri.length + configLines + bitmaps;
}

/**
 * Greedily batch config lines into as few transactions as possible.
 *
 * `packIntoTransactions` in lib/solana/pack.ts packs *separate* builders; here the win comes from
 * putting many lines inside one `addConfigLines` instruction instead, so this grows a single
 * instruction until it stops fitting. That matters more than usual: the wallet bridge prompts
 * once per transaction (lib/solana/umi.ts), so batch size is literally how many times the creator
 * has to click approve.
 */
export function packConfigLines({
  umi,
  candyMachine,
  items,
  startIndex,
}: {
  umi: Umi;
  candyMachine: string;
  items: ConfigLineItem[];
  startIndex: number;
}): { index: number; configLines: ConfigLineItem[]; builder: TransactionBuilder }[] {
  const batches: { index: number; configLines: ConfigLineItem[]; builder: TransactionBuilder }[] = [];
  let cursor = 0;
  while (cursor < items.length) {
    const index = startIndex + cursor;
    let size = 1;
    let best: { configLines: ConfigLineItem[]; builder: TransactionBuilder } | null = null;
    // Double until it stops fitting, then walk back down — a linear probe would be hundreds of
    // builder constructions per batch on a drop with short lines.
    while (cursor + size <= items.length) {
      const configLines = items.slice(cursor, cursor + size);
      const builder = addConfigLines(umi, {
        candyMachine: publicKey(candyMachine),
        index,
        configLines,
      });
      if (!builder.fitsInOneTransaction(umi)) break;
      best = { configLines, builder };
      if (cursor + size === items.length) break;
      size *= 2;
    }
    if (!best) {
      // A single line that cannot fit means the item's name/uri is too long to ever be written.
      throw new Error(
        `Item ${index + 1} is too large to fit in one transaction — shorten its name or metadata URI.`
      );
    }
    // Refine upward one at a time from the last size that fit, to use the full transaction.
    let refined = best;
    while (cursor + refined.configLines.length < items.length) {
      const configLines = items.slice(cursor, cursor + refined.configLines.length + 1);
      const builder = addConfigLines(umi, {
        candyMachine: publicKey(candyMachine),
        index,
        configLines,
      });
      if (!builder.fitsInOneTransaction(umi)) break;
      refined = { configLines, builder };
    }
    batches.push({ index, ...refined });
    cursor += refined.configLines.length;
  }
  return batches;
}

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------

export type DeployStage =
  | "collection"
  | "creating"
  | "recording"
  | "uploading"
  | "done";

export type DeployParams = {
  supabase: SupabaseClient;
  umi: Umi;
  collectionId: string;
  collectionName: string;
  /** Existing on-chain Core collection, if the creator already has one for this drop. */
  collectionAddress: string | null;
  creatorWallet: string;
  treasuryWallet: string | null;
  royaltyBps: number;
  feeBps: number;
  phases: PhaseGuardInput[];
  allowlist: string[];
  items: ConfigLineItem[];
  onStage?: (stage: DeployStage, progress?: { done: number; total: number }) => void;
};

export type DeployResult = {
  candyMachine: string;
  candyGuard: string;
  collectionAddress: string;
  itemsLoaded: number;
};

/** How often to re-broadcast a signed transaction that hasn't confirmed yet. */
const REBROADCAST_INTERVAL_MS = 2000;

/**
 * Send one transaction and wait for it, re-broadcasting until it lands.
 *
 * A blockhash is valid for ~150 slots (roughly 60-90s), and two things eat that window here:
 * the creator has to approve in their wallet before the transaction can even be sent, and a
 * public devnet RPC drops transactions routinely with nothing to re-broadcast them. Either way
 * the result is the same "block height exceeded" — the transaction never landed and the
 * blockhash aged out. So the signed transaction is re-sent on a timer for as long as we are
 * waiting. Re-sending is free and safe: it is byte-identical, so it carries the same signature
 * and the network deduplicates it.
 */
async function sendAndConfirm(
  umi: Umi,
  builder: TransactionBuilder,
  extraSigners: Signer[] = []
): Promise<string> {
  // "confirmed" rather than "finalized": a finalized blockhash is already ~32 slots old, which
  // is validity we would be throwing away before the wallet has even prompted.
  const blockhash = await withRpcRetry(() =>
    umi.rpc.getLatestBlockhash({ commitment: "confirmed" })
  );
  const withBlockhash = builder.setFeePayer(umi.identity).setBlockhash(blockhash);
  let transaction = withBlockhash.build(umi);
  // Wallet first: some wallets rewrite the transaction while signing, which would invalidate
  // keypair signatures applied before theirs (same ordering rule as lib/mint/mint.ts).
  transaction = await umi.identity.signTransaction(transaction);
  for (const signer of extraSigners) {
    if (signer.publicKey === umi.identity.publicKey) continue;
    transaction = await signer.signTransaction(transaction);
  }

  // The first send keeps preflight on, so a genuine program error (a guard that rejects, a bad
  // account) surfaces here with a usable message instead of a transaction that silently never
  // lands and is only reported 90 seconds later as an expiry.
  const signatureBytes = await withRpcRetry(() => umi.rpc.sendTransaction(transaction));
  const signature = base58.deserialize(signatureBytes)[0];

  let waiting = true;
  const rebroadcast = (async () => {
    while (waiting) {
      await new Promise((resolve) => setTimeout(resolve, REBROADCAST_INTERVAL_MS));
      if (!waiting) return;
      // Preflight off on re-sends: it would only re-simulate work the first send already
      // validated, and a transient simulation failure must not stop us re-broadcasting.
      await umi.rpc.sendTransaction(transaction, { skipPreflight: true }).catch(() => {});
    }
  })();

  try {
    await umi.rpc.confirmTransaction(signatureBytes, {
      strategy: { type: "blockhash", ...blockhash },
      commitment: "confirmed",
    });
    return signature;
  } catch (e) {
    // Expiry and "it landed" are a genuine race, and getting this wrong is expensive: a caller
    // that retries a candy machine creation which actually succeeded deploys a *second* machine
    // and strands the first one's rent. So never report failure without asking the chain.
    const [status] = await withRpcRetry(() => umi.rpc.getSignatureStatuses([signatureBytes]));
    if (status && !status.error) return signature;
    if (status?.error) {
      throw new Error(`Transaction ${signature} failed on chain: ${String(status.error)}`);
    }
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Transaction ${signature} did not land before its blockhash expired (${message}). ` +
        `Nothing was charged for it. This usually means the network dropped it or the wallet ` +
        `approval took too long — retry, approving promptly when your wallet prompts.`
    );
  } finally {
    waiting = false;
    await rebroadcast;
  }
}

/**
 * Deploy a candy machine for an existing collection row, then load its config lines.
 *
 * Split into "create" and "load" on purpose. Creating the machine is one transaction and is what
 * makes the drop real; loading config lines is many, and a large drop will not survive a single
 * browser session of wallet prompts. So the addresses and the item count are written to Postgres
 * the moment the machine exists, and `cm_items_loaded` advances batch by batch — `resumeUpload`
 * picks up from there. A half-loaded machine cannot mint (the chain rejects an unwritten line),
 * so an interrupted upload is a pause, not a broken drop.
 */
export async function deployCandyMachine(p: DeployParams): Promise<DeployResult> {
  const { supabase, umi } = p;
  if (p.items.length === 0) throw new Error("A drop needs at least one item.");
  if (p.phases.length === 0) {
    throw new Error("Add at least one mint phase before deploying — phases become the guards.");
  }

  // 1. The Core collection. Reuse the creator's existing one when there is one; otherwise create
  //    it here so it carries the Royalties plugin (the quick-mint flow doesn't add one).
  let collectionAddress = p.collectionAddress;
  if (!collectionAddress) {
    p.onStage?.("collection");
    const signer = generateSigner(umi);
    await sendAndConfirm(
      umi,
      createCoreCollection(umi, {
        collection: signer,
        name: p.collectionName,
        uri: p.items[0].uri,
        plugins: [
          {
            type: "Royalties",
            basisPoints: p.royaltyBps,
            creators: [{ address: publicKey(p.creatorWallet), percentage: 100 }],
            ruleSet: ruleSet("None"),
          },
        ],
      }),
      [signer]
    );
    collectionAddress = signer.publicKey;
    // Record it immediately, not with the rest in step 3. The candy machine creation below can
    // fail (an expired blockhash is the common one), and without this a retry would take the
    // `!collectionAddress` branch again and mint a second, orphaned collection.
    const { error } = await supabase
      .from("collections")
      .update({ collection_address: collectionAddress })
      .eq("id", p.collectionId);
    if (error) {
      throw new Error(
        `Collection ${collectionAddress} was created on chain, but recording it failed: ${error.message}`
      );
    }
  }

  // 2. The candy machine + its guard, in one transaction.
  p.onStage?.("creating");
  const groups = phasesToGuardGroups({
    phases: p.phases,
    creatorWallet: p.creatorWallet,
    treasuryWallet: p.treasuryWallet,
    allowlist: p.allowlist,
    feeBps: p.feeBps,
  });
  const settings = deriveConfigLineSettings(p.items);
  const candyMachineSigner = generateSigner(umi);
  const createBuilder = await createCandyMachine(umi, {
    candyMachine: candyMachineSigner,
    collection: publicKey(collectionAddress),
    collectionUpdateAuthority: umi.identity,
    itemsAvailable: p.items.length,
    configLineSettings: some(settings),
    // Every mint must name a group, so the default guard set stays empty and each phase's
    // group carries the real rules. A mint that names no group is rejected outright.
    guards: {},
    groups: groups.map(({ label, guards }) => ({ label, guards })),
  });
  // Only the candy machine's own keypair signs here. The collection was created in its own
  // transaction above and merely referenced by this one, so passing its signer would try to
  // add a signature the message has no slot for.
  await sendAndConfirm(umi, createBuilder, [candyMachineSigner]);

  const candyMachine = candyMachineSigner.publicKey;
  const candyGuard = (await fetchCandyMachine(umi, publicKey(candyMachine))).mintAuthority;

  // 3. Record the addresses before loading lines, so an interrupted upload is resumable.
  p.onStage?.("recording");
  const { error: collectionError } = await supabase
    .from("collections")
    .update({
      candy_machine_address: candyMachine,
      candy_guard_address: candyGuard,
      collection_address: collectionAddress,
      cm_items_available: p.items.length,
      cm_items_loaded: 0,
    })
    .eq("id", p.collectionId);
  if (collectionError) {
    throw new Error(
      `Candy machine ${candyMachine} was created on chain, but recording it failed: ${collectionError.message}`
    );
  }
  for (const group of groups) {
    const { error } = await supabase
      .from("mint_phases")
      .update({ guard_label: group.label })
      .eq("id", group.phaseId);
    if (error) throw new Error(`Failed to label phase for its guard group: ${error.message}`);
  }

  // 4. Config lines.
  const itemsLoaded = await uploadConfigLines({
    supabase,
    umi,
    collectionId: p.collectionId,
    candyMachine,
    items: p.items,
    startIndex: 0,
    onProgress: (done, total) => p.onStage?.("uploading", { done, total }),
  });

  p.onStage?.("done");
  return { candyMachine, candyGuard, collectionAddress, itemsLoaded };
}

/**
 * Write config lines from `startIndex` on, advancing `cm_items_loaded` after each batch lands.
 * Returns the total number of items loaded. A failure part-way through leaves the counter at the
 * last batch that landed, so calling again resumes rather than rewriting.
 */
export async function uploadConfigLines({
  supabase,
  umi,
  collectionId,
  candyMachine,
  items,
  startIndex,
  onProgress,
}: {
  supabase: SupabaseClient;
  umi: Umi;
  collectionId: string;
  candyMachine: string;
  items: ConfigLineItem[];
  startIndex: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<number> {
  const settings = deriveConfigLineSettings(items);
  const remaining = stripPrefixes(items, settings).slice(startIndex);
  const batches = packConfigLines({ umi, candyMachine, items: remaining, startIndex });

  let loaded = startIndex;
  const total = items.length;
  onProgress?.(loaded, total);
  for (const batch of batches) {
    await sendAndConfirm(umi, batch.builder);
    loaded += batch.configLines.length;
    const { error } = await supabase
      .from("collections")
      .update({ cm_items_loaded: loaded })
      .eq("id", collectionId);
    if (error) {
      throw new Error(
        `Loaded ${loaded} of ${total} items on chain, but recording progress failed: ${error.message}. Reopen setup to resume.`
      );
    }
    onProgress?.(loaded, total);
  }
  return loaded;
}

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

export type CandyMintStage = "allowlist" | "signing" | "sending" | "confirming" | "recording";

export type CandyMintParams = {
  supabase: SupabaseClient;
  umi: Umi;
  collectionId: string;
  candyMachine: string;
  candyGuard: string;
  collectionAddress: string;
  creatorWallet: string;
  treasuryWallet: string | null;
  guardLabel: string;
  /** Wallets on the allowlist, when the active phase is allowlist-only. */
  allowlist: string[] | null;
  onStage?: (stage: CandyMintStage) => void;
};

/**
 * Mint one item from the candy machine, signed by the buyer's own wallet.
 *
 * The client picks nothing but the group label — price, window, per-wallet limit and allowlist
 * membership are all checked on chain, so a client that lies about any of them gets a failed
 * transaction rather than a cheap mint. The `nfts` row is written afterwards by the `launch-mint`
 * edge function, which re-derives everything from the landed signature and the asset account.
 */
export async function mintFromCandyMachine(p: CandyMintParams): Promise<{
  signature: string;
  assetAddress: string;
}> {
  const { umi } = p;
  const asset = generateSigner(umi);

  const mintArgs: Partial<DefaultGuardSetMintArgs> = {
    solPayment: some({ destination: publicKey(p.creatorWallet) }),
  };
  if (p.treasuryWallet) {
    mintArgs.solFixedFee = some({ destination: publicKey(p.treasuryWallet) });
  }

  // An allowlist guard needs the caller's merkle proof written to a PDA *before* the mint, in its
  // own transaction — the mint instruction only reads the proof account.
  if (p.allowlist) {
    p.onStage?.("allowlist");
    const wallet = umi.identity.publicKey;
    const proof = getMerkleProof(p.allowlist, wallet);
    await sendAndConfirm(
      umi,
      route(umi, {
        candyMachine: publicKey(p.candyMachine),
        candyGuard: publicKey(p.candyGuard),
        guard: "allowList",
        group: some(p.guardLabel),
        routeArgs: { path: "proof", merkleRoot: getMerkleRoot(p.allowlist), merkleProof: proof },
      })
    );
    mintArgs.allowList = some({ merkleRoot: getMerkleRoot(p.allowlist) });
  }

  p.onStage?.("signing");
  const builder = mintV1(umi, {
    candyMachine: publicKey(p.candyMachine),
    candyGuard: publicKey(p.candyGuard),
    asset,
    collection: publicKey(p.collectionAddress),
    group: some(p.guardLabel) as OptionOrNullable<string>,
    mintArgs,
  });

  p.onStage?.("sending");
  const signature = await sendAndConfirm(umi, builder, [asset]);

  // The mint is irreversible from here — it is on chain. Recording is a separate service-role
  // round trip that can fail on its own, and a failure must read as "recorded late", not "lost":
  // `launch-mint` is keyed on the signature, so calling it again with the same one is safe.
  p.onStage?.("recording");
  await recordCandyMachineMint(p.supabase, {
    collectionId: p.collectionId,
    assetAddress: asset.publicKey,
    signature,
  });

  return { signature, assetAddress: asset.publicKey };
}

/** How many items the machine has actually sold, straight from the chain. */
export async function fetchMintProgress(
  umi: Umi,
  candyMachine: string
): Promise<{ itemsRedeemed: number; itemsAvailable: number }> {
  const machine = await fetchCandyMachine(umi, publicKey(candyMachine));
  return {
    itemsRedeemed: Number(machine.itemsRedeemed),
    itemsAvailable: Number(machine.data.itemsAvailable),
  };
}

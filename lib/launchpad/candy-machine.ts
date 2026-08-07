import { createCollection } from "@metaplex-foundation/mpl-core";
import {
  addConfigLines,
  create,
  fetchCandyMachine,
  findAllowListProofPda,
  findCandyGuardPda,
  getCandyMachineSize,
  getMerkleProof,
  getMerkleRoot,
  mintV1,
  mplCandyMachine,
  route,
  updateCandyGuard,
} from "@metaplex-foundation/mpl-core-candy-machine";
import {
  generateSigner,
  publicKey,
  signAllTransactions,
  some,
  type PublicKey,
  type Signer,
  type TransactionBuilder,
  type Umi,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  configLineFor,
  feeOf,
  guardGroupsFor,
  mintLimitId,
  nameSettings,
  orderPhases,
  phaseGroupLabel,
  phaseIndexFromLabel,
  uriSettings,
  type PhaseInput,
} from "@/lib/launchpad/candy-guards";
import { getSettlementAuthority } from "@/lib/listings/listings";
import { buildNftMetadata } from "@/lib/mint/metadata";
import { invokeFunction } from "@/lib/settle/invoke";
import { withRpcRetry } from "@/lib/solana/retry";

/**
 * The enforced launchpad: a Metaplex Core Candy Machine per drop.
 *
 * Unlike the advisory path (creator pre-mints the supply, lists it, and the app politely refuses
 * to sell outside a phase), nothing here is pre-minted. The creator loads config lines — one per
 * item — and the buyer's own transaction mints the asset straight out of the machine. Price,
 * window, per-wallet limit and allowlist are candy guards, so they hold against anyone talking to
 * the program directly; this app is just a convenient client.
 *
 * The bounded retries below are not paranoia: at "confirmed" commitment an account written by one
 * transaction is not necessarily readable by the next RPC call, and each step here reads what the
 * previous one wrote (Initialize reads the collection, AddConfigLines reads the machine, MintV1
 * reads the config lines and the allowlist proof). Skipping the wait makes the *program* panic or
 * reject on a state it can't see yet, which reads as a baffling failure. Devnet showed all four.
 */

export type DeployStage = "metadata" | "collection" | "machine" | "items" | "recording";
export type MintStage = "allowlist" | "signing" | "sending" | "confirming" | "recording";

/** Cheap upper bound on how big a drop this flow will attempt in one go. */
export const MAX_DROP_SUPPLY = 250;

const VISIBILITY_ATTEMPTS = 45;
const VISIBILITY_DELAY_MS = 2000;

function withCandyMachine(umi: Umi): Umi {
  return umi.use(mplCandyMachine());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Block until an account written by an earlier transaction is readable by this RPC. */
async function waitForAccount(umi: Umi, address: PublicKey, label: string): Promise<void> {
  for (let attempt = 0; attempt < VISIBILITY_ATTEMPTS; attempt++) {
    const exists = await withRpcRetry(() => umi.rpc.accountExists(address));
    if (exists) return;
    await delay(VISIBILITY_DELAY_MS);
  }
  throw new Error(`${label} did not become readable on the RPC. It may still be on chain — retry in a moment.`);
}

// Wallet first: if the wallet modifies the transaction while signing (some do), keypair
// signatures applied afterwards stay valid. Same ordering the mint flow relies on.
function identityFirst(signers: Signer[], umi: Umi): Signer[] {
  return [...signers].sort((a, b) => {
    if (a.publicKey === umi.identity.publicKey) return -1;
    if (b.publicKey === umi.identity.publicKey) return 1;
    return 0;
  });
}

/** Sign with the wallet (one prompt), send, and confirm — the unit every step here is built from. */
async function sendBuilder(umi: Umi, builder: TransactionBuilder): Promise<string> {
  const blockhash = await withRpcRetry(() => umi.rpc.getLatestBlockhash());
  const withBlockhash = builder.setFeePayer(umi.identity).setBlockhash(blockhash);
  const [signed] = await signAllTransactions([
    {
      transaction: withBlockhash.build(umi),
      signers: identityFirst(withBlockhash.getSigners(umi), umi),
    },
  ]);
  const signatureBytes = await withRpcRetry(() => umi.rpc.sendTransaction(signed));
  await withRpcRetry(() =>
    umi.rpc.confirmTransaction(signatureBytes, {
      strategy: { type: "blockhash", ...blockhash },
      commitment: "confirmed",
    })
  );
  return base58.deserialize(signatureBytes)[0];
}

function merkleRootFor(allowlist: string[]): Uint8Array | null {
  return allowlist.length > 0 ? getMerkleRoot(allowlist) : null;
}

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------

export type CandyMachineRow = {
  id: string;
  candyMachineAddress: string;
  candyGuardAddress: string;
  itemsAvailable: number;
  itemsLoaded: number;
  itemsRedeemed: number;
  prefixName: string;
  prefixUri: string;
};

export type DeployParams = {
  supabase: SupabaseClient;
  umi: Umi;
  collectionId: string;
  collectionName: string;
  description: string | null;
  /** On-chain Core collection; created here when the drop doesn't have one yet. */
  collectionAddress: string | null;
  creatorId: string;
  creatorWallet: string;
  imageUrl: string;
  imageType?: string;
  supply: number;
  phases: PhaseInput[];
  allowlist: string[];
  /** A previous partial deploy to continue — config lines resume where it stopped. */
  existing?: CandyMachineRow | null;
  onStage?: (stage: DeployStage) => void;
};

export type DeployResult = {
  candyMachineAddress: string;
  candyGuardAddress: string;
  collectionAddress: string;
  itemsLoaded: number;
  signatures: string[];
};

/**
 * Stand up (or finish standing up) a drop's candy machine.
 *
 * Deliberately ordered so an interrupted run is resumable rather than orphaned: the DB row is
 * written as soon as the machine exists on chain, before the config lines that take the most
 * transactions, and `items_loaded` advances chunk by chunk. Re-running picks up from there —
 * which matters because every transaction here is a separate wallet prompt (the wallet-standard
 * bridge signs one per approval), so a long load is exactly where someone walks away.
 */
export async function deployCandyMachine(params: DeployParams): Promise<DeployResult> {
  const {
    supabase,
    collectionId,
    collectionName,
    description,
    creatorId,
    creatorWallet,
    imageUrl,
    supply,
    phases,
    allowlist,
    existing,
    onStage,
  } = params;
  const umi = withCandyMachine(params.umi);

  if (supply < 1 || supply > MAX_DROP_SUPPLY) {
    throw new Error(`Supply must be between 1 and ${MAX_DROP_SUPPLY}.`);
  }
  if (phases.length === 0) {
    throw new Error("Add at least one mint phase before deploying — the guards are built from them.");
  }
  if (umi.identity.publicKey !== creatorWallet) {
    throw new Error("Connect the wallet that created this collection to deploy its candy machine.");
  }

  const signatures: string[] = [];
  let collectionAddress = params.collectionAddress;
  let row = existing ?? null;

  if (!row) {
    // 1. One metadata file per item. The config line only carries "<n>.json"; the shared prefix
    //    lives in the machine, which is what keeps a 250-item drop inside a couple of transactions.
    onStage?.("metadata");
    const dropId = crypto.randomUUID();
    const folder = `${creatorId}/${dropId}`;
    const imageType = params.imageType ?? "image/png";
    const { prefixName, nameLength } = nameSettings(collectionName, supply);
    const upload = async (file: string, body: unknown) => {
      const { error } = await supabase.storage
        .from("nft-media")
        .upload(`${folder}/${file}`, new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }), {
          contentType: "application/json",
          upsert: true,
        });
      if (error) throw new Error(`Metadata upload failed on ${file}: ${error.message}`);
      return supabase.storage.from("nft-media").getPublicUrl(`${folder}/${file}`).data.publicUrl;
    };

    for (let n = 1; n <= supply; n++) {
      // Named from the same prefix the config lines use, so the metadata document and the name
      // the chain composes agree even when a long collection name had to be truncated to fit.
      await upload(`${n}.json`, buildNftMetadata({ name: `${prefixName}${n}`, description, imageUrl, imageType }));
    }
    const collectionMetadataUrl = await upload(
      "collection.json",
      buildNftMetadata({ name: collectionName, description, imageUrl, imageType })
    );
    // Derived from a real item URL rather than assembled by hand, so the prefix is exactly what
    // the storage layer will serve — an off-by-one slash here would break every item's metadata.
    const firstItemUrl = supabase.storage.from("nft-media").getPublicUrl(`${folder}/1.json`).data.publicUrl;
    const prefixUri = firstItemUrl.slice(0, firstItemUrl.length - "1.json".length);
    const uri = uriSettings(prefixUri, supply);

    // 2. The Core collection the machine mints into. The creator must be its update authority —
    //    Initialize makes the machine a delegate of it.
    if (!collectionAddress) {
      onStage?.("collection");
      const collectionSigner = generateSigner(umi);
      signatures.push(
        await sendBuilder(
          umi,
          createCollection(umi, { collection: collectionSigner, name: collectionName, uri: collectionMetadataUrl })
        )
      );
      collectionAddress = collectionSigner.publicKey;
      const { error } = await supabase
        .from("collections")
        .update({ collection_address: collectionAddress })
        .eq("id", collectionId);
      if (error) throw new Error(`Collection created on chain, but recording it failed: ${error.message}`);
    }
    await waitForAccount(umi, publicKey(collectionAddress), "The collection");

    // 3. The machine plus its guard, with one group per phase.
    onStage?.("machine");
    const candyMachineSigner = generateSigner(umi);
    const groups = guardGroupsFor(phases, {
      creatorWallet,
      treasuryWallet: getSettlementAuthority(),
      merkleRoot: merkleRootFor(allowlist),
    });
    const builder = await create(umi, {
      candyMachine: candyMachineSigner,
      collection: publicKey(collectionAddress),
      collectionUpdateAuthority: umi.identity,
      itemsAvailable: supply,
      authority: umi.identity.publicKey,
      configLineSettings: some({
        prefixName,
        nameLength,
        prefixUri: uri.prefixUri,
        uriLength: uri.uriLength,
        // Random assignment — a generative drop's whole point is that you don't know which item
        // you're minting. It's also why the item number can only be read back off the asset.
        isSequential: false,
      }),
      guards: {},
      groups,
    });
    const deployTx = await sendBuilder(umi, builder);
    signatures.push(deployTx);

    const candyGuardAddress = findCandyGuardPda(umi, { base: candyMachineSigner.publicKey })[0];
    onStage?.("recording");
    const { data, error } = await supabase
      .from("candy_machines")
      .insert({
        collection_id: collectionId,
        candy_machine_address: candyMachineSigner.publicKey,
        candy_guard_address: candyGuardAddress,
        authority_wallet: creatorWallet,
        items_available: supply,
        items_loaded: 0,
        prefix_name: prefixName,
        prefix_uri: uri.prefixUri,
        deploy_tx: deployTx,
      })
      .select("id")
      .single();
    if (error) {
      throw new Error(
        `The candy machine ${candyMachineSigner.publicKey} was created on chain, but recording it failed: ${error.message}`
      );
    }
    await writeGroupLabels(supabase, phases);
    row = {
      id: data.id,
      candyMachineAddress: candyMachineSigner.publicKey,
      candyGuardAddress,
      itemsAvailable: supply,
      itemsLoaded: 0,
      itemsRedeemed: 0,
      prefixName,
      prefixUri: uri.prefixUri,
    };
    await waitForAccount(umi, publicKey(row.candyMachineAddress), "The candy machine");
  }

  if (!collectionAddress) {
    throw new Error("This drop's candy machine exists but its collection address is missing — reload and retry.");
  }

  // 4. Load the items. Chunked to fill transactions, and `items_loaded` is advanced after each
  //    one lands so an abandoned deploy resumes instead of restarting.
  onStage?.("items");
  let loaded = row.itemsLoaded;
  for (const chunk of configLineChunks(umi, publicKey(row.candyMachineAddress), loaded, row.itemsAvailable)) {
    signatures.push(
      await sendBuilder(
        umi,
        addConfigLines(umi, {
          candyMachine: publicKey(row.candyMachineAddress),
          index: chunk.index,
          configLines: chunk.lines,
        })
      )
    );
    loaded = chunk.index + chunk.lines.length;
    const { error } = await supabase.from("candy_machines").update({ items_loaded: loaded }).eq("id", row.id);
    if (error) throw new Error(`Items loaded on chain, but recording progress failed: ${error.message}`);
  }

  return {
    candyMachineAddress: row.candyMachineAddress,
    candyGuardAddress: row.candyGuardAddress,
    collectionAddress,
    itemsLoaded: loaded,
    signatures,
  };
}

/** Record which guard group each phase became, so a mint can name its group. */
async function writeGroupLabels(supabase: SupabaseClient, phases: PhaseInput[]): Promise<void> {
  const ordered = orderPhases(phases);
  for (const [index, phase] of ordered.entries()) {
    const { error } = await supabase
      .from("mint_phases")
      .update({ group_label: phaseGroupLabel(index) })
      .eq("id", phase.id);
    if (error) throw new Error(`Failed to label phase "${phase.name}": ${error.message}`);
  }
}

/**
 * Greedily pack config lines into as few transactions as possible by asking umi whether the
 * built instruction still fits — the same trick the mint flow uses, and the reason a 100-item
 * drop is a couple of wallet prompts rather than a hundred.
 */
function configLineChunks(
  umi: Umi,
  candyMachine: PublicKey,
  from: number,
  to: number
): { index: number; lines: { name: string; uri: string }[] }[] {
  const chunks: { index: number; lines: { name: string; uri: string }[] }[] = [];
  let index = from;
  let lines: { name: string; uri: string }[] = [];
  for (let n = from; n < to; n++) {
    const line = configLineFor(n + 1);
    const candidate = [...lines, line];
    const fits = addConfigLines(umi, { candyMachine, index, configLines: candidate }).fitsInOneTransaction(umi);
    if (!fits && lines.length > 0) {
      chunks.push({ index, lines });
      index = n;
      lines = [line];
    } else {
      lines = candidate;
    }
  }
  if (lines.length > 0) chunks.push({ index, lines });
  return chunks;
}

/**
 * Re-push the guard groups after the creator edits phases or the allowlist. Without this a phase
 * edited post-deploy would only change what the page claims while the chain kept enforcing the
 * old rules — the one way this path could end up lying.
 */
export async function syncCandyGuards({
  supabase,
  umi: baseUmi,
  candyMachineAddress,
  creatorWallet,
  phases,
  allowlist,
}: {
  supabase: SupabaseClient;
  umi: Umi;
  candyMachineAddress: string;
  creatorWallet: string;
  phases: PhaseInput[];
  allowlist: string[];
}): Promise<{ signature: string }> {
  const umi = withCandyMachine(baseUmi);
  if (phases.length === 0) throw new Error("A drop needs at least one phase.");
  const groups = guardGroupsFor(phases, {
    creatorWallet,
    treasuryWallet: getSettlementAuthority(),
    merkleRoot: merkleRootFor(allowlist),
  });
  const signature = await sendBuilder(
    umi,
    updateCandyGuard(umi, {
      candyGuard: findCandyGuardPda(umi, { base: publicKey(candyMachineAddress) })[0],
      guards: {},
      groups,
    })
  );
  await writeGroupLabels(supabase, phases);
  return { signature };
}

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

export type CandyMintParams = {
  supabase: SupabaseClient;
  umi: Umi;
  collectionId: string;
  collectionAddress: string;
  candyMachineAddress: string;
  creatorWallet: string;
  allowlist: string[];
  /** The phase being minted — its guards decide which mint args the program expects. */
  phase: PhaseInput & { groupLabel: string };
  onStage?: (stage: MintStage) => void;
};

export type CandyMintResult = { assetAddress: string; signature: string; nftId: string | null };

/**
 * Mint one item from the machine. The guards do the enforcing, so a rejection here is the chain
 * disagreeing (wrong phase, limit reached, not allowlisted) rather than this app deciding.
 */
export async function mintFromCandyMachine(params: CandyMintParams): Promise<CandyMintResult> {
  const { supabase, collectionId, collectionAddress, candyMachineAddress, creatorWallet, allowlist, phase, onStage } =
    params;
  const umi = withCandyMachine(params.umi);
  const candyMachine = publicKey(candyMachineAddress);
  const index = phaseIndexFromLabel(phase.groupLabel);
  const merkleRoot = merkleRootFor(allowlist);

  // An allowlist-only phase needs a proof PDA on chain before the mint will pass. It's a separate
  // transaction (and so a separate wallet prompt), but only the first time for this wallet.
  if (phase.allowlistOnly) {
    if (!merkleRoot) throw new Error("This phase is allowlist-only but the allowlist is empty.");
    const [proofPda] = findAllowListProofPda(umi, {
      merkleRoot,
      user: umi.identity.publicKey,
      candyMachine,
      candyGuard: findCandyGuardPda(umi, { base: candyMachine })[0],
    });
    const alreadyProven = await withRpcRetry(() => umi.rpc.accountExists(proofPda));
    if (!alreadyProven) {
      onStage?.("allowlist");
      await sendBuilder(
        umi,
        route(umi, {
          candyMachine,
          guard: "allowList",
          group: some(phase.groupLabel),
          routeArgs: {
            path: "proof",
            merkleRoot,
            merkleProof: getMerkleProof(allowlist, umi.identity.publicKey),
          },
        })
      );
      await waitForAccount(umi, proofPda, "Your allowlist proof");
    }
  }

  onStage?.("signing");
  const asset = generateSigner(umi);
  const fee = feeOf(phase.priceLamports);
  const signature = await sendBuilder(
    umi,
    mintV1(umi, {
      candyMachine,
      asset,
      collection: publicKey(collectionAddress),
      group: some(phase.groupLabel),
      mintArgs: {
        ...(phase.priceLamports > 0n ? { solPayment: some({ destination: publicKey(creatorWallet) }) } : {}),
        ...(fee > 0n ? { solFixedFee: some({ destination: publicKey(getSettlementAuthority()) }) } : {}),
        ...(phase.perWalletLimit != null ? { mintLimit: some({ id: mintLimitId(index) }) } : {}),
        ...(phase.allowlistOnly && merkleRoot ? { allowList: some({ merkleRoot }) } : {}),
      },
    })
  );

  // The asset is minted and paid for at this point; everything below is bookkeeping, and the
  // recorder verifies the transaction against the chain rather than taking this call's word.
  onStage?.("recording");
  await waitForAccount(umi, asset.publicKey, "Your new item");
  let nftId: string | null = null;
  try {
    const result = await invokeFunction(
      supabase,
      "candy-mint",
      { collectionId, assetAddress: asset.publicKey, signature },
      "Recording the mint failed."
    );
    nftId = result?.nftId ?? null;
  } catch (e) {
    throw new Error(
      `Minted ${asset.publicKey} on chain (${signature}), but recording it failed: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }
  return { assetAddress: asset.publicKey, signature, nftId };
}

/**
 * What deploying will cost the creator: rent for the machine (which scales with supply, since
 * every config line is pre-allocated on chain) plus the collection, plus transaction fees. Shown
 * before they sign, because "rent for 250 config lines" is not a number anyone can guess.
 */
export async function estimateDeployCost(
  baseUmi: Umi,
  { supply, collectionName, needsCollection }: { supply: number; collectionName: string; needsCollection: boolean }
): Promise<bigint> {
  const umi = withCandyMachine(baseUmi);
  const { prefixName, nameLength } = nameSettings(collectionName, supply);
  const { uriLength } = uriSettings("", supply);
  const space = getCandyMachineSize(
    supply,
    some({ prefixName, nameLength, prefixUri: "", uriLength, isSequential: false })
  );
  const rent = await withRpcRetry(() => umi.rpc.getRent(space));
  // Core collection rent, and a few transactions' worth of fees.
  const collectionRent = needsCollection ? 3_500_000n : 0n;
  return rent.basisPoints + collectionRent + 100_000n;
}

/** Live supply straight from the machine, for the moments the cached counts aren't good enough. */
export async function readCandyMachineSupply(
  baseUmi: Umi,
  candyMachineAddress: string
): Promise<{ itemsAvailable: number; itemsLoaded: number; itemsRedeemed: number }> {
  const umi = withCandyMachine(baseUmi);
  const machine = await withRpcRetry(() => fetchCandyMachine(umi, publicKey(candyMachineAddress)));
  return {
    itemsAvailable: Number(machine.data.itemsAvailable),
    itemsLoaded: machine.itemsLoaded,
    itemsRedeemed: Number(machine.itemsRedeemed),
  };
}

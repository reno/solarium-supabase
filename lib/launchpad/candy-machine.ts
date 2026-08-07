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
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
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

export type DeployStage = "metadata" | "collection" | "machine" | "items" | "recording";
export type MintStage = "allowlist" | "signing" | "sending" | "confirming" | "recording";

export const MAX_DROP_SUPPLY = 250;

const VISIBILITY_ATTEMPTS = 45;
const VISIBILITY_DELAY_MS = 2000;

function withCandyMachine(umi: Umi): Umi {
  return umi.use(mplCandyMachine());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// At "confirmed" commitment an account written by one transaction is not necessarily
// readable by the next RPC call, and each deploy step reads what the previous one wrote.
async function waitForAccount(umi: Umi, address: PublicKey, label: string): Promise<void> {
  for (let attempt = 0; attempt < VISIBILITY_ATTEMPTS; attempt++) {
    const exists = await withRpcRetry(() => umi.rpc.accountExists(address));
    if (exists) return;
    await delay(VISIBILITY_DELAY_MS);
  }
  throw new Error(`${label} did not become readable on the RPC. It may still be on chain — retry in a moment.`);
}

// Wallet signs first, or later keypair signatures break: some wallets modify the
// transaction while signing, invalidating signatures applied before them.
function identityFirst(signers: Signer[], umi: Umi): Signer[] {
  return [...signers].sort((a, b) => {
    if (a.publicKey === umi.identity.publicKey) return -1;
    if (b.publicKey === umi.identity.publicKey) return 1;
    return 0;
  });
}

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
  collectionAddress: string | null;
  creatorId: string;
  creatorWallet: string;
  imageUrl: string;
  imageType?: string;
  supply: number;
  phases: PhaseInput[];
  allowlist: string[];
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
      await upload(`${n}.json`, buildNftMetadata({ name: `${prefixName}${n}`, description, imageUrl, imageType }));
    }
    const collectionMetadataUrl = await upload(
      "collection.json",
      buildNftMetadata({ name: collectionName, description, imageUrl, imageType })
    );
    const firstItemUrl = supabase.storage.from("nft-media").getPublicUrl(`${folder}/1.json`).data.publicUrl;
    const prefixUri = firstItemUrl.slice(0, firstItemUrl.length - "1.json".length);
    const uri = uriSettings(prefixUri, supply);

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

  onStage?.("items");
  let loaded = row.itemsLoaded;
  for (const chunk of configLineChunks(umi, publicKey(row.candyMachineAddress), loaded, row.itemsAvailable)) {
    signatures.push(
      await sendBuilder(
        umi,
        addConfigLinesBuilder(umi, publicKey(row.candyMachineAddress), chunk.index, chunk.lines)
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

// Config lines are tiny on the wire, so compute — not transaction size — is the ceiling:
// ~4.4k CU each, and the 200k default runs out around 45 lines mid-batch.
const COMPUTE_UNITS_PER_CONFIG_LINE = 5_000;
const COMPUTE_UNITS_BASE = 40_000;
const MAX_TRANSACTION_COMPUTE_UNITS = 1_400_000;
const MAX_CONFIG_LINES_PER_TRANSACTION = Math.floor(
  (MAX_TRANSACTION_COMPUTE_UNITS - COMPUTE_UNITS_BASE) / COMPUTE_UNITS_PER_CONFIG_LINE
);

// Used to both measure a chunk and send it — they must be the same shape, or the
// compute-budget instruction's own bytes go missing from the fit calculation.
function addConfigLinesBuilder(
  umi: Umi,
  candyMachine: PublicKey,
  index: number,
  configLines: { name: string; uri: string }[]
): TransactionBuilder {
  const units = Math.min(
    MAX_TRANSACTION_COMPUTE_UNITS,
    COMPUTE_UNITS_BASE + configLines.length * COMPUTE_UNITS_PER_CONFIG_LINE
  );
  return setComputeUnitLimit(umi, { units }).add(addConfigLines(umi, { candyMachine, index, configLines }));
}

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
    const fits =
      candidate.length <= MAX_CONFIG_LINES_PER_TRANSACTION &&
      addConfigLinesBuilder(umi, candyMachine, index, candidate).fitsInOneTransaction(umi);
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

export type CandyMintParams = {
  supabase: SupabaseClient;
  umi: Umi;
  collectionId: string;
  collectionAddress: string;
  candyMachineAddress: string;
  creatorWallet: string;
  allowlist: string[];
  phase: PhaseInput & { groupLabel: string };
  onStage?: (stage: MintStage) => void;
};

export type CandyMintResult = { assetAddress: string; signature: string; nftId: string | null };

export async function mintFromCandyMachine(params: CandyMintParams): Promise<CandyMintResult> {
  const { supabase, collectionId, collectionAddress, candyMachineAddress, creatorWallet, allowlist, phase, onStage } =
    params;
  const umi = withCandyMachine(params.umi);
  const candyMachine = publicKey(candyMachineAddress);
  const index = phaseIndexFromLabel(phase.groupLabel);
  const merkleRoot = merkleRootFor(allowlist);

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
  const collectionRent = needsCollection ? 3_500_000n : 0n;
  return rent.basisPoints + collectionRent + 100_000n;
}

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

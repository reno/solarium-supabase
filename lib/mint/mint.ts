import { create, createCollection } from "@metaplex-foundation/mpl-core";
import {
  generateSigner,
  signAllTransactions,
  type Signer,
  type TransactionBuilder,
  type Umi,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildNftMetadata, itemName } from "@/lib/mint/metadata";
import { packIntoTransactions } from "@/lib/solana/pack";
import { withRpcRetry } from "@/lib/solana/retry";

export const MAX_SUPPLY = 30;

export type MintStage = "uploading" | "signing" | "sending" | "recording";

export type MintParams = {
  supabase: SupabaseClient;
  umi: Umi;
  creatorId: string;
  file: Blob;
  fileName: string;
  name: string;
  description: string | null;
  quantity: number;
  onStage?: (stage: MintStage) => void;
};

export type MintResult = {
  assetAddresses: string[];
  collectionAddress: string | null;
  collectionId: string | null;
  signatures: string[];
};

// Wallet signs first, or later keypair signatures break: some wallets modify the
// transaction while signing, invalidating signatures applied before them.
function identityFirst(signers: Signer[], umi: Umi): Signer[] {
  return [...signers].sort((a, b) => {
    if (a.publicKey === umi.identity.publicKey) return -1;
    if (b.publicKey === umi.identity.publicKey) return 1;
    return 0;
  });
}

export async function mintNfts({
  supabase,
  umi,
  creatorId,
  file,
  fileName,
  name,
  description,
  quantity,
  onStage,
}: MintParams): Promise<MintResult> {
  if (quantity < 1 || quantity > MAX_SUPPLY) {
    throw new Error(`Quantity must be between 1 and ${MAX_SUPPLY}.`);
  }

  onStage?.("uploading");
  const dropId = crypto.randomUUID();
  const ext = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase()
    : "png";
  const imageType = file.type || "image/png";
  const imagePath = `${creatorId}/${dropId}/image.${ext}`;

  const { error: imageError } = await supabase.storage
    .from("nft-media")
    .upload(imagePath, file, { contentType: imageType });
  if (imageError) throw new Error(`Image upload failed: ${imageError.message}`);
  const imageUrl = supabase.storage.from("nft-media").getPublicUrl(imagePath)
    .data.publicUrl;

  const metadata = buildNftMetadata({ name, description, imageUrl, imageType });
  const metadataPath = `${creatorId}/${dropId}/metadata.json`;
  const { error: metadataError } = await supabase.storage
    .from("nft-media")
    .upload(
      metadataPath,
      new Blob([JSON.stringify(metadata, null, 2)], {
        type: "application/json",
      }),
      { contentType: "application/json" }
    );
  if (metadataError) {
    throw new Error(`Metadata upload failed: ${metadataError.message}`);
  }
  const metadataUrl = supabase.storage
    .from("nft-media")
    .getPublicUrl(metadataPath).data.publicUrl;

  const assetSigners = Array.from({ length: quantity }, () =>
    generateSigner(umi)
  );
  const collectionSigner = quantity > 1 ? generateSigner(umi) : null;

  const items: { builder: TransactionBuilder; keys: number[] }[] = [];
  if (collectionSigner) {
    items.push({
      builder: createCollection(umi, {
        collection: collectionSigner,
        name,
        uri: metadataUrl,
      }),
      keys: [],
    });
  }
  assetSigners.forEach((asset, index) => {
    items.push({
      builder: create(umi, {
        asset,
        name: itemName(name, index + 1, quantity),
        uri: metadataUrl,
        ...(collectionSigner
          ? {
              collection: {
                publicKey: collectionSigner.publicKey,
                oracles: [],
                lifecycleHooks: [],
              },
            }
          : {}),
      }),
      keys: [index],
    });
  });
  const chunks = packIntoTransactions(umi, items);

  const signatures: string[] = [];
  const confirmedAssetIndices: number[] = [];
  const assetMintTx: Record<number, string> = {};
  let sendError: Error | null = null;
  let collectionConfirmed = collectionSigner === null;

  for (const [chunkIndex, chunk] of chunks.entries()) {
    try {
      onStage?.("signing");
      const blockhash = await withRpcRetry(() => umi.rpc.getLatestBlockhash());
      const withBlockhash = chunk.builder
        .setFeePayer(umi.identity)
        .setBlockhash(blockhash);
      const [signed] = await signAllTransactions([
        {
          transaction: withBlockhash.build(umi),
          signers: identityFirst(withBlockhash.getSigners(umi), umi),
        },
      ]);

      onStage?.("sending");
      const signatureBytes = await withRpcRetry(() =>
        umi.rpc.sendTransaction(signed)
      );
      const hasDependentChunk = chunkIndex < chunks.length - 1;
      await withRpcRetry(() =>
        umi.rpc.confirmTransaction(signatureBytes, {
          strategy: { type: "blockhash", ...blockhash },
          // Only a chunk something else depends on waits for "finalized" — that wait eats
          // into the blockhash's ~60-90s window, so the last chunk uses "confirmed".
          commitment: hasDependentChunk ? "finalized" : "confirmed",
        })
      );
      const signature = base58.deserialize(signatureBytes)[0];
      signatures.push(signature);
      if (chunkIndex === 0) collectionConfirmed = true;
      for (const assetIndex of chunk.keys) {
        confirmedAssetIndices.push(assetIndex);
        assetMintTx[assetIndex] = signature;
      }
    } catch (e) {
      sendError = e instanceof Error ? e : new Error(String(e));
      break;
    }
  }

  const assetAddresses: string[] = [];
  let collectionId: string | null = null;
  if (confirmedAssetIndices.length > 0 || (collectionSigner && collectionConfirmed)) {
    onStage?.("recording");
    if (collectionSigner && collectionConfirmed) {
      const { data: collectionRow, error: collectionInsertError } =
        await supabase
          .from("collections")
          .insert({
            creator_id: creatorId,
            collection_address: collectionSigner.publicKey,
            name,
            description,
            cover_url: imageUrl,
          })
          .select("id")
          .single();
      if (collectionInsertError) {
        throw new Error(
          `Minted on chain, but recording the collection failed: ${collectionInsertError.message}`
        );
      }
      collectionId = collectionRow.id;
    }

    if (confirmedAssetIndices.length > 0) {
      const ownerWallet = umi.identity.publicKey;
      const rows = confirmedAssetIndices.map((index) => ({
        asset_address: assetSigners[index].publicKey,
        collection_id: collectionId,
        creator_id: creatorId,
        owner_id: creatorId,
        owner_wallet: ownerWallet,
        name: itemName(name, index + 1, quantity),
        description,
        image_url: imageUrl,
        metadata_url: metadataUrl,
        edition_number: quantity > 1 ? index + 1 : null,
        mint_tx: assetMintTx[index],
      }));
      const { data: nftRows, error: nftInsertError } = await supabase
        .from("nfts")
        .insert(rows)
        .select("id");
      if (nftInsertError) {
        throw new Error(
          `Minted on chain, but recording the NFTs failed: ${nftInsertError.message}`
        );
      }
      await supabase.from("activities").insert(
        nftRows.map((row: { id: string }) => ({
          type: "mint",
          nft_id: row.id,
          actor_id: creatorId,
        }))
      );
      if (collectionId) {
        const [stats, rarity] = await Promise.all([
          supabase.rpc("refresh_collection_stats", { p_collection: collectionId }),
          supabase.rpc("recompute_collection_rarity", { p_collection: collectionId }),
        ]);
        if (stats.error) console.warn(`Collection stats not refreshed: ${stats.error.message}`);
        if (rarity.error) console.warn(`Collection rarity not recomputed: ${rarity.error.message}`);
      }
      assetAddresses.push(
        ...confirmedAssetIndices.map((index) => assetSigners[index].publicKey)
      );
    }
  }

  if (sendError) {
    throw new Error(
      `Minted ${confirmedAssetIndices.length} of ${quantity} items before a transaction failed: ${sendError.message}`
    );
  }

  return {
    assetAddresses,
    collectionAddress: collectionSigner ? collectionSigner.publicKey : null,
    collectionId,
    signatures,
  };
}

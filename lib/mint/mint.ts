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

import { buildNftMetadata, editionName } from "@/lib/mint/metadata";
import { withRpcRetry } from "@/lib/solana/retry";

export const MAX_EDITIONS = 30;

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
  signatures: string[];
};

type TxChunk = {
  builder: TransactionBuilder;
  assetIndices: number[];
};

function packIntoTransactions(
  umi: Umi,
  items: { builder: TransactionBuilder; assetIndex: number | null }[]
): TxChunk[] {
  const chunks: TxChunk[] = [];
  for (const item of items) {
    const indices = item.assetIndex === null ? [] : [item.assetIndex];
    const last = chunks[chunks.length - 1];
    if (last) {
      const merged = last.builder.add(item.builder);
      if (merged.fitsInOneTransaction(umi)) {
        last.builder = merged;
        last.assetIndices.push(...indices);
        continue;
      }
    }
    chunks.push({ builder: item.builder, assetIndices: indices });
  }
  return chunks;
}

// Wallet first: if the wallet modifies the transaction while signing (some
// wallets do), keypair signatures applied afterwards remain valid.
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
  if (quantity < 1 || quantity > MAX_EDITIONS) {
    throw new Error(`Quantity must be between 1 and ${MAX_EDITIONS}.`);
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

  const items: { builder: TransactionBuilder; assetIndex: number | null }[] =
    [];
  if (collectionSigner) {
    items.push({
      builder: createCollection(umi, {
        collection: collectionSigner,
        name,
        uri: metadataUrl,
      }),
      assetIndex: null,
    });
  }
  assetSigners.forEach((asset, index) => {
    items.push({
      builder: create(umi, {
        asset,
        name: editionName(name, index + 1, quantity),
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
      assetIndex: index,
    });
  });
  const chunks = packIntoTransactions(umi, items);

  // Later chunks reference the collection created by an earlier one, so each
  // is given a fresh blockhash and sent one at a time (not batched) so a
  // dependent chunk isn't built against a collection that hasn't landed yet.
  // Track what lands so partial failures still get recorded.
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
      // Only a chunk with a later chunk depending on it (i.e. the collection
      // creation, when there's more than one chunk) needs to wait for
      // "finalized" visibility — that wait eats into the blockhash's ~60-90s
      // validity window, so the common single-chunk case (and the last chunk
      // of any mint) uses "confirmed" instead to avoid expiring the signature.
      const hasDependentChunk = chunkIndex < chunks.length - 1;
      await withRpcRetry(() =>
        umi.rpc.confirmTransaction(signatureBytes, {
          strategy: { type: "blockhash", ...blockhash },
          commitment: hasDependentChunk ? "finalized" : "confirmed",
        })
      );
      const signature = base58.deserialize(signatureBytes)[0];
      signatures.push(signature);
      if (chunkIndex === 0) collectionConfirmed = true;
      for (const assetIndex of chunk.assetIndices) {
        confirmedAssetIndices.push(assetIndex);
        assetMintTx[assetIndex] = signature;
      }
    } catch (e) {
      sendError = e instanceof Error ? e : new Error(String(e));
      break;
    }
  }

  const assetAddresses: string[] = [];
  if (confirmedAssetIndices.length > 0 || (collectionSigner && collectionConfirmed)) {
    onStage?.("recording");
    let collectionId: string | null = null;
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
        name: editionName(name, index + 1, quantity),
        description,
        image_url: imageUrl,
        metadata_url: metadataUrl,
        edition_number: quantity > 1 ? index + 1 : null,
        edition_total: quantity > 1 ? quantity : null,
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
      assetAddresses.push(
        ...confirmedAssetIndices.map((index) => assetSigners[index].publicKey)
      );
    }
  }

  if (sendError) {
    throw new Error(
      `Minted ${confirmedAssetIndices.length} of ${quantity} editions before a transaction failed: ${sendError.message}`
    );
  }

  return {
    assetAddresses,
    collectionAddress: collectionSigner ? collectionSigner.publicKey : null,
    signatures,
  };
}

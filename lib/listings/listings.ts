import { addPlugin, fetchAsset, removePlugin } from "@metaplex-foundation/mpl-core";
import { publicKey, type Umi } from "@metaplex-foundation/umi";
import type { SupabaseClient } from "@supabase/supabase-js";

import { withRpcRetry } from "@/lib/solana/retry";

// Listings are off-chain rows; the only chain state is a Core TransferDelegate
// granted to the platform settlement authority at listing time, so a future
// sale can settle atomically (transfer + payment) with only the buyer signing.

export function getSettlementAuthority(): string {
  const address = process.env.NEXT_PUBLIC_SETTLEMENT_AUTHORITY;
  if (!address) {
    throw new Error("NEXT_PUBLIC_SETTLEMENT_AUTHORITY is not set");
  }
  return address;
}

export type ListingNft = {
  id: string;
  assetAddress: string;
  collectionAddress: string | null;
};

export type ListStage = "checking" | "signing" | "sending" | "confirming" | "saving";
export type CancelStage = "signing" | "sending" | "confirming" | "saving";

// DB-only halves, kept separate so they can be exercised without a wallet.

export async function recordListing(
  supabase: SupabaseClient,
  {
    nftId,
    sellerId,
    priceLamports,
  }: { nftId: string; sellerId: string; priceLamports: bigint }
): Promise<{ listingId: string }> {
  const { data, error } = await supabase
    .from("listings")
    .insert({
      nft_id: nftId,
      seller_id: sellerId,
      price_lamports: priceLamports.toString(),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new Error("This NFT already has an active listing.");
    }
    throw new Error(`Failed to record the listing: ${error.message}`);
  }
  await supabase.from("activities").insert({
    type: "list",
    nft_id: nftId,
    actor_id: sellerId,
    lamports: priceLamports.toString(),
  });
  return { listingId: data.id };
}

export async function recordDelisting(
  supabase: SupabaseClient,
  {
    listingId,
    nftId,
    sellerId,
  }: { listingId: string; nftId: string; sellerId: string }
): Promise<void> {
  const { error } = await supabase
    .from("listings")
    .update({ status: "cancelled" })
    .eq("id", listingId)
    .eq("seller_id", sellerId)
    .eq("status", "active");
  if (error) {
    throw new Error(`Failed to cancel the listing: ${error.message}`);
  }
  await supabase.from("activities").insert({
    type: "delist",
    nft_id: nftId,
    actor_id: sellerId,
  });
}

// Full flows: chain step first, then the row. If recording fails after the
// delegate landed, the DB stays consistent (no listing row → not for sale) and
// the delegate is harmless until a listing exists.

export async function listNft({
  supabase,
  umi,
  nft,
  sellerId,
  priceLamports,
  onStage,
}: {
  supabase: SupabaseClient;
  umi: Umi;
  nft: ListingNft;
  sellerId: string;
  priceLamports: bigint;
  onStage?: (stage: ListStage) => void;
}): Promise<{ listingId: string }> {
  if (priceLamports <= 0n) throw new Error("Price must be greater than zero.");
  const settlementAuthority = getSettlementAuthority();

  onStage?.("checking");
  // A prior sale's TransferDelegate resets to Owner-authority once used (Core's
  // delegates are one-shot) but the plugin itself isn't removed, so a bought
  // asset can still be carrying one — clear it before adding a fresh one.
  const asset = await withRpcRetry(() =>
    fetchAsset(umi, publicKey(nft.assetAddress))
  );
  let builder = asset.transferDelegate
    ? removePlugin(umi, {
        asset: publicKey(nft.assetAddress),
        ...(nft.collectionAddress
          ? { collection: publicKey(nft.collectionAddress) }
          : {}),
        plugin: { type: "TransferDelegate" },
      })
    : undefined;

  const addDelegate = addPlugin(umi, {
    asset: publicKey(nft.assetAddress),
    ...(nft.collectionAddress
      ? { collection: publicKey(nft.collectionAddress) }
      : {}),
    plugin: {
      type: "TransferDelegate",
      authority: { type: "Address", address: publicKey(settlementAuthority) },
    },
  });
  builder = builder ? builder.add(addDelegate) : addDelegate;

  onStage?.("signing");
  const blockhash = await withRpcRetry(() => umi.rpc.getLatestBlockhash());
  const signed = await withRpcRetry(() =>
    builder.setBlockhash(blockhash).buildAndSign(umi)
  );

  onStage?.("sending");
  const signatureBytes = await withRpcRetry(() => umi.rpc.sendTransaction(signed));

  onStage?.("confirming");
  await withRpcRetry(() =>
    umi.rpc.confirmTransaction(signatureBytes, {
      strategy: { type: "blockhash", ...blockhash },
    })
  );

  onStage?.("saving");
  return await recordListing(supabase, {
    nftId: nft.id,
    sellerId,
    priceLamports,
  });
}

export async function cancelListing({
  supabase,
  umi,
  nft,
  listingId,
  sellerId,
  onStage,
}: {
  supabase: SupabaseClient;
  umi: Umi;
  nft: ListingNft;
  listingId: string;
  sellerId: string;
  onStage?: (stage: CancelStage) => void;
}): Promise<void> {
  onStage?.("signing");
  const blockhash = await withRpcRetry(() => umi.rpc.getLatestBlockhash());
  const signed = await withRpcRetry(() =>
    removePlugin(umi, {
      asset: publicKey(nft.assetAddress),
      ...(nft.collectionAddress
        ? { collection: publicKey(nft.collectionAddress) }
        : {}),
      plugin: { type: "TransferDelegate" },
    })
      .setBlockhash(blockhash)
      .buildAndSign(umi)
  );

  onStage?.("sending");
  const signatureBytes = await withRpcRetry(() => umi.rpc.sendTransaction(signed));

  onStage?.("confirming");
  await withRpcRetry(() =>
    umi.rpc.confirmTransaction(signatureBytes, {
      strategy: { type: "blockhash", ...blockhash },
    })
  );

  onStage?.("saving");
  await recordDelisting(supabase, { listingId, nftId: nft.id, sellerId });
}

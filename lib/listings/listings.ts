import { addPlugin, fetchAllAssets, fetchAsset, removePlugin } from "@metaplex-foundation/mpl-core";
import { publicKey, type TransactionBuilder, type Umi } from "@metaplex-foundation/umi";
import type { SupabaseClient } from "@supabase/supabase-js";

import { packIntoTransactions } from "@/lib/solana/pack";
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
export type BulkListStage = "checking" | "sending" | "saving";

function expiryAt(expiresInHours?: number | null): string | null {
  return expiresInHours && expiresInHours > 0
    ? new Date(Date.now() + expiresInHours * 3_600_000).toISOString()
    : null;
}

// DB-only halves, kept separate so they can be exercised without a wallet.

export async function recordListing(
  supabase: SupabaseClient,
  {
    nftId,
    sellerId,
    priceLamports,
    expiresInHours,
  }: { nftId: string; sellerId: string; priceLamports: bigint; expiresInHours?: number | null }
): Promise<{ listingId: string }> {
  const expiresAt = expiryAt(expiresInHours);
  const { data, error } = await supabase
    .from("listings")
    .insert({
      nft_id: nftId,
      seller_id: sellerId,
      price_lamports: priceLamports.toString(),
      expires_at: expiresAt,
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

/** One insert for a whole batch, then one for their activity rows. */
export async function recordListings(
  supabase: SupabaseClient,
  {
    nftIds,
    sellerId,
    priceLamports,
    expiresInHours,
  }: { nftIds: string[]; sellerId: string; priceLamports: bigint; expiresInHours?: number | null }
): Promise<void> {
  if (nftIds.length === 0) return;
  const expiresAt = expiryAt(expiresInHours);
  const price = priceLamports.toString();
  const { error } = await supabase.from("listings").insert(
    nftIds.map((nft_id) => ({
      nft_id,
      seller_id: sellerId,
      price_lamports: price,
      expires_at: expiresAt,
    }))
  );
  if (error) {
    if (error.code === "23505") {
      throw new Error("Some of these items were listed already — reload the page and try again.");
    }
    throw new Error(`Failed to record the listings: ${error.message}`);
  }
  await supabase.from("activities").insert(
    nftIds.map((nft_id) => ({ type: "list", nft_id, actor_id: sellerId, lamports: price }))
  );
}

/**
 * Change the price of listings that are already up. Purely a Postgres update — the price is
 * off-chain and the transfer delegate granted at listing time stays valid, so no wallet
 * signature is involved. Returns how many rows moved.
 */
export async function repriceListings(
  supabase: SupabaseClient,
  {
    nftIds,
    sellerId,
    priceLamports,
  }: { nftIds: string[]; sellerId: string; priceLamports: bigint }
): Promise<number> {
  if (priceLamports <= 0n) throw new Error("Price must be greater than zero.");
  if (nftIds.length === 0) return 0;
  const price = priceLamports.toString();
  const { data, error } = await supabase
    .from("listings")
    .update({ price_lamports: price })
    .in("nft_id", nftIds)
    .eq("seller_id", sellerId)
    .eq("status", "active")
    .select("nft_id");
  if (error) throw new Error(`Failed to update the price: ${error.message}`);
  const changed = data ?? [];
  if (changed.length === 0) return 0;
  // Show up in price history and the activity feed, same as the original listing did.
  await supabase.from("activities").insert(
    changed.map((l: { nft_id: string }) => ({
      type: "list",
      nft_id: l.nft_id,
      actor_id: sellerId,
      lamports: price,
    }))
  );
  return changed.length;
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

/**
 * The chain half of listing one asset: grant the settlement authority a TransferDelegate.
 *
 * A prior sale's TransferDelegate resets to Owner-authority once used (Core's delegates are
 * one-shot) but the plugin itself isn't removed, so a bought asset can still be carrying one —
 * `hasDelegate` says to clear it first.
 */
function delegateBuilder(
  umi: Umi,
  nft: ListingNft,
  settlementAuthority: string,
  hasDelegate: boolean
): TransactionBuilder {
  const collection = nft.collectionAddress
    ? { collection: publicKey(nft.collectionAddress) }
    : {};
  const add = addPlugin(umi, {
    asset: publicKey(nft.assetAddress),
    ...collection,
    plugin: {
      type: "TransferDelegate",
      authority: { type: "Address", address: publicKey(settlementAuthority) },
    },
  });
  if (!hasDelegate) return add;
  return removePlugin(umi, {
    asset: publicKey(nft.assetAddress),
    ...collection,
    plugin: { type: "TransferDelegate" },
  }).add(add);
}

export async function listNft({
  supabase,
  umi,
  nft,
  sellerId,
  priceLamports,
  expiresInHours,
  onStage,
}: {
  supabase: SupabaseClient;
  umi: Umi;
  nft: ListingNft;
  sellerId: string;
  priceLamports: bigint;
  expiresInHours?: number | null;
  onStage?: (stage: ListStage) => void;
}): Promise<{ listingId: string }> {
  if (priceLamports <= 0n) throw new Error("Price must be greater than zero.");
  const settlementAuthority = getSettlementAuthority();

  onStage?.("checking");
  const asset = await withRpcRetry(() =>
    fetchAsset(umi, publicKey(nft.assetAddress))
  );
  const builder = delegateBuilder(umi, nft, settlementAuthority, Boolean(asset.transferDelegate));

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
    expiresInHours,
  });
}

/**
 * List many assets at one price — the launchpad's "list the whole supply at the phase price".
 *
 * The delegate grants are packed into as few transactions as the size limit allows, which is what
 * keeps this to a handful of wallet approvals instead of one per item (the wallet bridge signs one
 * transaction per prompt). Sending stops at the first failure, but everything that already landed
 * is still recorded, so a partial run leaves the DB matching the chain rather than losing listings
 * for assets that are already delegated.
 */
export async function listNfts({
  supabase,
  umi,
  nfts,
  sellerId,
  priceLamports,
  expiresInHours,
  onStage,
  onProgress,
}: {
  supabase: SupabaseClient;
  umi: Umi;
  nfts: ListingNft[];
  sellerId: string;
  priceLamports: bigint;
  expiresInHours?: number | null;
  onStage?: (stage: BulkListStage) => void;
  /** Transactions confirmed so far, out of the total to send. */
  onProgress?: (done: number, total: number) => void;
}): Promise<{ listed: number; requested: number }> {
  if (priceLamports <= 0n) throw new Error("Price must be greater than zero.");
  if (nfts.length === 0) return { listed: 0, requested: 0 };
  const settlementAuthority = getSettlementAuthority();

  onStage?.("checking");
  const assets = await withRpcRetry(() =>
    fetchAllAssets(
      umi,
      nfts.map((n) => n.assetAddress)
    )
  );
  const carriesDelegate = new Set(
    assets.filter((a) => a.transferDelegate).map((a) => String(a.publicKey))
  );

  const chunks = packIntoTransactions(
    umi,
    nfts.map((nft) => ({
      builder: delegateBuilder(umi, nft, settlementAuthority, carriesDelegate.has(nft.assetAddress)),
      keys: [nft],
    }))
  );

  onStage?.("sending");
  onProgress?.(0, chunks.length);
  const landed: ListingNft[] = [];
  let sendError: Error | null = null;
  for (const [index, chunk] of chunks.entries()) {
    try {
      // A fresh blockhash per chunk: each one is a separate wallet approval, and the user may
      // take a while over them.
      const blockhash = await withRpcRetry(() => umi.rpc.getLatestBlockhash());
      const signed = await withRpcRetry(() =>
        chunk.builder.setFeePayer(umi.identity).setBlockhash(blockhash).buildAndSign(umi)
      );
      const signatureBytes = await withRpcRetry(() => umi.rpc.sendTransaction(signed));
      await withRpcRetry(() =>
        umi.rpc.confirmTransaction(signatureBytes, {
          strategy: { type: "blockhash", ...blockhash },
        })
      );
      landed.push(...chunk.keys);
      onProgress?.(index + 1, chunks.length);
    } catch (e) {
      sendError = e instanceof Error ? e : new Error(String(e));
      break;
    }
  }

  onStage?.("saving");
  await recordListings(supabase, {
    nftIds: landed.map((n) => n.id),
    sellerId,
    priceLamports,
    expiresInHours,
  });

  if (sendError) {
    throw new Error(
      `Listed ${landed.length} of ${nfts.length} items before a transaction failed: ${sendError.message}`
    );
  }
  return { listed: landed.length, requested: nfts.length };
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

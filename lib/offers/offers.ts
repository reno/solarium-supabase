import type { SupabaseClient } from "@supabase/supabase-js";

// Soft offers (bids): plain off-chain rows under RLS. Creating/cancelling touches no
// chain state — funds stay in the bidder's wallet until the seller accepts (see the
// offers accept flow, which is where the bidder actually signs a payment). RLS scopes
// every write to the caller (bidder_id = auth.uid()).

export type CreateOfferInput = {
  nftId: string;
  bidderId: string;
  priceLamports: bigint;
  expiresInHours?: number;
};

export async function createOffer(
  supabase: SupabaseClient,
  { nftId, bidderId, priceLamports, expiresInHours = 24 }: CreateOfferInput
): Promise<{ id: string }> {
  const expiresAt = new Date(Date.now() + expiresInHours * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from("offers")
    .insert({
      nft_id: nftId,
      bidder_id: bidderId,
      price_lamports: priceLamports.toString(),
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new Error("You already have an active offer on this item. Cancel it first to re-bid.");
    }
    // The insert policy refuses an offer on an NFT the bidder owns. The UI hides the button in
    // that case, so this only fires on a stale page (the item was transferred to you meanwhile).
    if (error.code === "42501") {
      throw new Error("You can't bid on an item you own.");
    }
    throw new Error(`Failed to place offer: ${error.message}`);
  }
  // Record the bid in the activity feed (best-effort; don't fail the offer on this).
  await supabase.from("activities").insert({
    type: "bid",
    nft_id: nftId,
    actor_id: bidderId,
    lamports: priceLamports.toString(),
  });
  return data as { id: string };
}

export type CreateCollectionOfferInput = {
  collectionId: string;
  bidderId: string;
  priceLamports: bigint;
  quantity?: number;
  expiresInHours?: number;
};

/** A soft collection offer: a bid on ANY item in the collection, up to `quantity` items. Any
 *  holder can accept it against one of their items (the settle function binds it on accept). */
export async function createCollectionOffer(
  supabase: SupabaseClient,
  { collectionId, bidderId, priceLamports, quantity = 1, expiresInHours = 24 }: CreateCollectionOfferInput
): Promise<{ id: string }> {
  const expiresAt = new Date(Date.now() + expiresInHours * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from("offers")
    .insert({
      collection_id: collectionId,
      bidder_id: bidderId,
      price_lamports: priceLamports.toString(),
      quantity,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new Error("You already have an active collection offer here. Cancel it first to re-bid.");
    }
    throw new Error(`Failed to place collection offer: ${error.message}`);
  }
  // Collection-level bid: no nft_id in the activity feed row.
  await supabase.from("activities").insert({
    type: "bid",
    actor_id: bidderId,
    lamports: priceLamports.toString(),
  });
  return data as { id: string };
}

export async function cancelOffer(
  supabase: SupabaseClient,
  { offerId, bidderId }: { offerId: string; bidderId: string }
): Promise<void> {
  const { error } = await supabase
    .from("offers")
    .update({ status: "cancelled" })
    .eq("id", offerId)
    .eq("bidder_id", bidderId)
    .eq("status", "active");
  if (error) {
    throw new Error(`Failed to cancel offer: ${error.message}`);
  }
}

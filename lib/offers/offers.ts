import type { SupabaseClient } from "@supabase/supabase-js";

// solToLamports accepts a leading minus, so a "-5" typed into a bid box parses to a negative
// bigint. The listing paths already reject that; offers did not, and a non-positive bid is
// meaningless in both directions — it also has a CHECK behind it, which would surface as a raw
// constraint error rather than something a person can act on.
function assertBiddablePrice(priceLamports: bigint): void {
  if (priceLamports <= 0n) {
    throw new Error("Enter an amount greater than zero.");
  }
}

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
  assertBiddablePrice(priceLamports);
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
    if (error.code === "42501") {
      throw new Error("You can't bid on an item you own.");
    }
    throw new Error(`Failed to place offer: ${error.message}`);
  }
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

export async function createCollectionOffer(
  supabase: SupabaseClient,
  { collectionId, bidderId, priceLamports, quantity = 1, expiresInHours = 24 }: CreateCollectionOfferInput
): Promise<{ id: string }> {
  assertBiddablePrice(priceLamports);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("Enter how many items you want to bid on.");
  }
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

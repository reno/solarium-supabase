import type { SupabaseClient } from "@supabase/supabase-js";

import { invokeSettle } from "@/lib/settle/invoke";

/** Seller consents to sell to a bidder at their offer price. Off-chain — the settle
 *  edge function (service role) marks the offer accepted; the bidder then completes it.
 *  For a collection offer, pass the `nftId` the seller is selling — the function binds the
 *  offer to that item before accepting. */
export async function acceptOffer(supabase: SupabaseClient, offerId: string, nftId?: string): Promise<void> {
  await invokeSettle(supabase, { action: "acceptOffer", offerId, ...(nftId ? { nftId } : {}) });
}

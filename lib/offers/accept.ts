import type { SupabaseClient } from "@supabase/supabase-js";

import { invokeSettle } from "@/lib/settle/invoke";

export async function acceptOffer(supabase: SupabaseClient, offerId: string, nftId?: string): Promise<void> {
  await invokeSettle(supabase, { action: "acceptOffer", offerId, ...(nftId ? { nftId } : {}) });
}

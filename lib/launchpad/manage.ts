import type { SupabaseClient } from "@supabase/supabase-js";

export type NewPhase = {
  collectionId: string;
  name: string;
  priceLamports: bigint;
  startsAt: string; // ISO
  endsAt: string | null;
  perWalletLimit: number | null;
  allowlistOnly: boolean;
  position: number;
};

export async function createPhase(supabase: SupabaseClient, p: NewPhase): Promise<void> {
  const { error } = await supabase.from("mint_phases").insert({
    collection_id: p.collectionId,
    name: p.name,
    price_lamports: p.priceLamports.toString(),
    starts_at: p.startsAt,
    ends_at: p.endsAt,
    per_wallet_limit: p.perWalletLimit,
    allowlist_only: p.allowlistOnly,
    position: p.position,
  });
  if (error) throw new Error(`Failed to add phase: ${error.message}`);
}

// collectionId is required rather than filtering on the phase id alone, matching how
// recordDelisting scopes to seller_id and cancelOffer to bidder_id. RLS is what actually
// authorizes this; carrying the scope in the query too means a policy regression on this table
// does not immediately become "anyone can delete any phase".
export async function deletePhase(
  supabase: SupabaseClient,
  phaseId: string,
  collectionId: string
): Promise<void> {
  const { error } = await supabase
    .from("mint_phases")
    .delete()
    .eq("id", phaseId)
    .eq("collection_id", collectionId);
  if (error) throw new Error(`Failed to remove phase: ${error.message}`);
}

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function addAllowlist(
  supabase: SupabaseClient,
  collectionId: string,
  wallets: string[]
): Promise<void> {
  const cleaned = wallets.map((w) => w.trim()).filter(Boolean);
  // These are hashed into the merkle root the candy guard enforces. A malformed address is not
  // a rejected mint later — it is a root that does not match what anyone can prove, so catching
  // it at entry is the only place it is cheap.
  const invalid = cleaned.find((wallet) => !BASE58_ADDRESS.test(wallet));
  if (invalid) throw new Error(`"${invalid}" is not a valid Solana wallet address.`);

  const rows = cleaned.map((wallet_address) => ({ collection_id: collectionId, wallet_address }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("launchpad_allowlist")
    // ignoreDuplicates → ON CONFLICT DO NOTHING; the table grants no UPDATE.
    .upsert(rows, { onConflict: "collection_id,wallet_address", ignoreDuplicates: true });
  if (error) throw new Error(`Failed to update allowlist: ${error.message}`);
}

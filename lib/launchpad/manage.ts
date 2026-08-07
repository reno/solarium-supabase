import type { SupabaseClient } from "@supabase/supabase-js";

// Launchpad setup by the collection creator. These are plain RLS-scoped writes — the
// mint_phases / launchpad_allowlist policies already require the caller to be the
// collection's creator, so no edge function is involved.

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

export async function deletePhase(supabase: SupabaseClient, phaseId: string): Promise<void> {
  const { error } = await supabase.from("mint_phases").delete().eq("id", phaseId);
  if (error) throw new Error(`Failed to remove phase: ${error.message}`);
}

export async function addAllowlist(
  supabase: SupabaseClient,
  collectionId: string,
  wallets: string[]
): Promise<void> {
  const rows = wallets
    .map((w) => w.trim())
    .filter(Boolean)
    .map((wallet_address) => ({ collection_id: collectionId, wallet_address }));
  if (rows.length === 0) return;
  // ignoreDuplicates → ON CONFLICT DO NOTHING (insert-only; the table grants no UPDATE).
  const { error } = await supabase
    .from("launchpad_allowlist")
    .upsert(rows, { onConflict: "collection_id,wallet_address", ignoreDuplicates: true });
  if (error) throw new Error(`Failed to update allowlist: ${error.message}`);
}

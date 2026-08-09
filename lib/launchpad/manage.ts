import type { SupabaseClient } from "@supabase/supabase-js";

export type NewPhase = {
  collectionId: string;
  name: string;
  priceLamports: bigint;
  startsAt: string;
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
  const invalid = cleaned.find((wallet) => !BASE58_ADDRESS.test(wallet));
  if (invalid) throw new Error(`"${invalid}" is not a valid Solana wallet address.`);

  const rows = cleaned.map((wallet_address) => ({ collection_id: collectionId, wallet_address }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("launchpad_allowlist")
    .upsert(rows, { onConflict: "collection_id,wallet_address", ignoreDuplicates: true });
  if (error) throw new Error(`Failed to update allowlist: ${error.message}`);
}

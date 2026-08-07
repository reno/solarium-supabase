import type { SupabaseClient } from "@supabase/supabase-js";

export type ApplicationPhase = {
  name: string;
  priceLamports: string;
  perWalletLimit: number | null;
  startsAt: string | null;
};

export type NewApplication = {
  creatorId: string;
  name: string;
  description: string | null;
  website: string | null;
  twitter: string | null;
  metadataSource: string | null;
  supply: number | null;
  mintPriceLamports: bigint | null;
  royaltyBps: number | null;
  perWalletLimit: number | null;
  revealMode: string | null;
  phases: ApplicationPhase[];
};

// Submit a launch application. The design frames this as "signs a message, no SOL spent";
// here it's a plain RLS-scoped insert (creator_id = auth.uid()) that enters pending review.
export async function submitApplication(supabase: SupabaseClient, app: NewApplication): Promise<void> {
  const { error } = await supabase.from("launch_applications").insert({
    creator_id: app.creatorId,
    name: app.name,
    description: app.description,
    website: app.website,
    twitter: app.twitter,
    metadata_source: app.metadataSource,
    supply: app.supply,
    mint_price_lamports: app.mintPriceLamports != null ? app.mintPriceLamports.toString() : null,
    royalty_bps: app.royaltyBps,
    per_wallet_limit: app.perWalletLimit,
    reveal_mode: app.revealMode,
    phases: app.phases,
  });
  if (error) throw new Error(`Failed to submit application: ${error.message}`);
}

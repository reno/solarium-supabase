import { FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Ask the `launch-mint` edge function to record a candy-machine mint.
 *
 * The buyer cannot write the `nfts` row themselves — the insert policy is `auth.uid() = creator_id`
 * and on a candy-machine drop the minter is not the creator — so recording goes through the
 * service role. The function re-derives everything from the landed signature and the asset
 * account, so this call passes only what it needs to look them up.
 *
 * Safe to retry: the function keys idempotency off the signature and answers a repeat with the
 * row it already wrote.
 */
export async function recordCandyMachineMint(
  supabase: SupabaseClient,
  args: { collectionId: string; assetAddress: string; signature: string }
): Promise<{ nftId?: string; alreadyRecorded?: boolean }> {
  const { data, error } = await supabase.functions.invoke("launch-mint", {
    body: { action: "record", ...args },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const details = await error.context.json().catch(() => null as { error?: string } | null);
      throw new Error(details?.error ?? "Recording the mint failed.");
    }
    throw error;
  }
  return data;
}

import type { SolanaWallet, SupabaseClient } from "@supabase/supabase-js";
import { getWalletAccountFeature } from "@wallet-standard/react";
import type { UiWalletAccount } from "@wallet-standard/react";

export const SOLANA_SIGN_IN_FEATURE = "solana:signIn";

export const SIGN_IN_STATEMENT =
  "Sign in to Solarium with your Solana wallet.";

type SignIn = NonNullable<SolanaWallet["signIn"]>;

export function accountSupportsSignIn(account: UiWalletAccount): boolean {
  return account.features.includes(SOLANA_SIGN_IN_FEATURE);
}

export function toSupabaseSolanaWallet(account: UiWalletAccount): SolanaWallet {
  const signIn: SignIn = async (...inputs) => {
    const feature = getWalletAccountFeature(
      account,
      SOLANA_SIGN_IN_FEATURE
    ) as { signIn: SignIn };
    const requests = inputs.length > 0 ? inputs : [{}];
    return await feature.signIn(
      ...requests.map((input) => ({ ...input, address: account.address }))
    );
  };
  return { signIn };
}

export async function signInWithSolanaAccount(
  supabase: SupabaseClient,
  account: UiWalletAccount
): Promise<{ needsOnboarding: boolean }> {
  const { data, error } = await supabase.auth.signInWithWeb3({
    chain: "solana",
    statement: SIGN_IN_STATEMENT,
    wallet: toSupabaseSolanaWallet(account),
  });
  if (error) throw error;

  // The signup trigger normally creates the profile row, but only on first
  // sign-in — recreate it if it has gone missing, then backfill the wallet
  // address on rows that predate it.
  await supabase
    .from("profiles")
    .upsert(
      { id: data.user.id, wallet_address: account.address },
      { onConflict: "id", ignoreDuplicates: true }
    );
  await supabase
    .from("profiles")
    .update({ wallet_address: account.address })
    .eq("id", data.user.id)
    .is("wallet_address", null);

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", data.user.id)
    .maybeSingle();

  return { needsOnboarding: !profile?.username };
}

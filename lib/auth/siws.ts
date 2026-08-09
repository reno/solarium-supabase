import type { SolanaWallet, SupabaseClient } from "@supabase/supabase-js";
import { getWalletAccountFeature } from "@wallet-standard/react";
import type { UiWalletAccount } from "@wallet-standard/react";

export const SOLANA_SIGN_IN_FEATURE = "solana:signIn";

export const SIGN_IN_STATEMENT =
  "Sign in to Solarium with your Solana wallet.";

const SIGN_IN_TTL_MS = 5 * 60 * 1000;

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
  const now = Date.now();
  const { data, error } = await supabase.auth.signInWithWeb3({
    chain: "solana",
    statement: SIGN_IN_STATEMENT,
    wallet: toSupabaseSolanaWallet(account),
    options: {
      signInWithSolana: {
        issuedAt: new Date(now).toISOString(),
        expirationTime: new Date(now + SIGN_IN_TTL_MS).toISOString(),
      },
    },
  });
  if (error) throw error;

  await supabase
    .from("profiles")
    .upsert({ id: data.user.id }, { onConflict: "id", ignoreDuplicates: true });

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", data.user.id)
    .maybeSingle();

  return { needsOnboarding: !profile?.username };
}

import type { SolanaWallet, SupabaseClient } from "@supabase/supabase-js";
import { getWalletAccountFeature } from "@wallet-standard/react";
import type { UiWalletAccount } from "@wallet-standard/react";

export const SOLANA_SIGN_IN_FEATURE = "solana:signIn";

export const SIGN_IN_STATEMENT =
  "Sign in to Solarium with your Solana wallet.";

// How long a signed sign-in message stays valid. Long enough to cover a slow wallet prompt,
// short enough that a captured signature is not a standing credential.
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
  // Without `signInWithSolana`, auth-js signs a message carrying only version/domain/uri/issuedAt
  // — no nonce and no expiry — so replay protection rests entirely on GoTrue's issued-at window,
  // and `issuedAt` comes from the *client's* clock. An explicit expirationTime bounds how long a
  // captured signature stays usable regardless of what the signing machine's clock said.
  //
  // A server-issued nonce would be stronger still, but it needs a round trip GoTrue does not
  // expose for this flow; the domain binding plus a short expiry is what is available here.
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

  // The profile row and its wallet_address are both written server-side: handle_new_user creates
  // the row from the signup metadata, and a trigger binds wallet_address to the address in the
  // verified JWT claim on any write. The client used to fill the column in itself, which is what
  // made it settable to somebody else's wallet — it holds no grant on it now, so an upsert
  // naming it would be rejected outright.
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

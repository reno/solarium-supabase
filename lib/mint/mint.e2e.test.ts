// End-to-end mint test against devnet + local supabase. Opt-in because it
// needs the local stack running, network access, and (for a full run) a
// non-dry devnet faucet — when the faucet is dry it degrades to a dry-run
// that still exercises upload, packing, signing, and RPC acceptance.
//
//   MINT_E2E=1 NEXT_PUBLIC_SOLANA_RPC_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//     pnpm test lib/mint/mint.e2e.test.ts
import { mplCore } from "@metaplex-foundation/mpl-core";
import { keypairIdentity, publicKey, sol } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

import { mintNfts } from "@/lib/mint/mint";

const SUPABASE_URL = "http://127.0.0.1:54321";
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ENABLED = process.env.MINT_E2E === "1";

const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  ),
  (c) => c.charCodeAt(0)
);

it.skipIf(!ENABLED)("mints 3 items end-to-end on devnet", { timeout: 240_000 }, async () => {
  const umi = createUmi(RPC_URL).use(mplCore());
  const keypair = umi.eddsa.generateKeypair();
  umi.use(keypairIdentity(keypair));
  const address = keypair.publicKey.toString();
  console.log("minter:", address);

  // Fund the throwaway key from the devnet faucet. When the faucet is dry we
  // still run the whole pipeline: the send will fail with a *funds* error,
  // which proves the transactions were well-formed (parsed + simulated).
  let funded = true;
  try {
    await umi.rpc.airdrop(keypair.publicKey, sol(0.1));
  } catch {
    funded = false;
    console.log("faucet dry — running unfunded dry-run instead");
  }

  const message = [
    "localhost:3000 wants you to sign in with your Solana account:",
    address,
    "",
    "Sign in to Solarium with your Solana wallet.",
    "",
    "URI: http://localhost:3000/",
    "Version: 1",
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
  const signature = await umi.eddsa.sign(
    new TextEncoder().encode(message),
    keypair
  );
  const supabase = createClient(SUPABASE_URL, ANON_KEY);
  const { data: auth, error: authError } = await supabase.auth.signInWithWeb3({
    chain: "solana",
    message,
    signature,
  });
  expect(authError).toBeNull();
  const userId = auth!.user!.id;
  console.log("supabase user:", userId);

  const stages: string[] = [];
  let result;
  try {
    result = await mintNfts({
      supabase,
      umi,
      creatorId: userId,
      file: new Blob([TINY_PNG], { type: "image/png" }),
      fileName: "pixel.png",
      name: "E2E Test Drop",
      description: "headless mint verification",
      quantity: 3,
      onStage: (stage) => stages.push(stage),
    });
  } catch (e) {
    if (funded) throw e;
    // Unfunded dry-run: upload, packing, and signing must have succeeded, and
    // the RPC must have rejected the transaction for lack of funds — not
    // because it was malformed.
    const message = e instanceof Error ? e.message : String(e);
    console.log("dry-run failure (expected):", message);
    expect(stages).toEqual(["uploading", "signing", "sending"]);
    expect(message).toContain("Minted 0 of 3");
    expect(message.toLowerCase()).toMatch(/debit|insufficient|fee/);
    const { data: nftRows } = await supabase
      .from("nfts")
      .select("id")
      .eq("creator_id", userId);
    expect(nftRows).toHaveLength(0);
    return;
  }

  console.log("assets:", result.assetAddresses);
  console.log("collection:", result.collectionAddress);
  console.log("txs:", result.signatures);
  expect(stages).toEqual(["uploading", "signing", "sending", "recording"]);
  expect(result.assetAddresses).toHaveLength(3);
  expect(result.collectionAddress).not.toBeNull();

  const { data: nftRows } = await supabase
    .from("nfts")
    .select("asset_address, name, edition_number, mint_tx, collection_id")
    .eq("creator_id", userId)
    .order("edition_number");
  expect(nftRows).toHaveLength(3);
  expect(nftRows![0].name).toBe("E2E Test Drop #1");
  expect(nftRows![0].collection_id).not.toBeNull();
  const { data: activityRows } = await supabase
    .from("activities")
    .select("type")
    .eq("actor_id", userId);
  expect(activityRows).toHaveLength(3);

  for (const assetAddress of result.assetAddresses) {
    const account = await umi.rpc.getAccount(publicKey(assetAddress));
    expect(account.exists).toBe(true);
  }
});

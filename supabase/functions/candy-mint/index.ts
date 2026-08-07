// Records a candy machine mint.
//
// The buyer mints straight from the chain, so by the time this runs the asset already exists and
// has already been paid for — the candy guards enforced price, window, per-wallet limit and
// allowlist inside the buyer's own transaction. What's left is the database mirror, and the buyer
// can't write that themselves: `nfts` only lets a collection's creator insert (by design — the
// row claims provenance), and the minter isn't the creator.
//
// So this function does what `settle` does for sales: it re-derives the facts from the chain
// rather than trusting the caller. The load-bearing check is the asset's update authority. Adding
// an asset to a Core collection requires the collection's authority or one of its delegates, and
// the candy machine is the only delegate here — so an asset that names this collection as its
// update authority provably came out of this drop's machine, not out of a caller's imagination.
import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import { publicKey, type Umi } from "npm:@metaplex-foundation/umi@1.5.1";
import { createUmi } from "npm:@metaplex-foundation/umi-bundle-defaults@1.5.1";
import { fetchAsset, mplCore } from "npm:@metaplex-foundation/mpl-core@1.10.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getUmi(): { umi: Umi; rpcUrl: string } {
  const rpcUrl = Deno.env.get("SOLANA_RPC_URL");
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL is not configured");
  return { umi: createUmi(rpcUrl).use(mplCore()), rpcUrl };
}

type Admin = ReturnType<typeof createClient>;

// Same backoff `settle` uses: by the time this runs the mint has already landed, so riding out a
// rate limit is always better than stranding a real item with no row.
async function rpcCall(rpcUrl: string, method: string, params: unknown[], attempt = 1): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  const isRateLimited =
    response.status === 429 ||
    (typeof body.error?.message === "string" && body.error.message.toLowerCase().includes("rate limit"));
  if (isRateLimited && attempt < 5) {
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    return rpcCall(rpcUrl, method, params, attempt + 1);
  }
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function walletOf(admin: Admin, userId: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("wallet_address").eq("id", userId).maybeSingle();
  return data?.wallet_address ?? null;
}

/** Item numbers come off the asset name the machine produced — assignment is random. */
function itemNumberFromName(name: string): number | null {
  const match = /#\s*(\d+)\s*$/.exec(name);
  return match ? Number(match[1]) : null;
}

/** The item's own art, from the metadata the config line pointed at. Cosmetic — never fatal. */
async function imageFromMetadata(uri: string): Promise<string | null> {
  try {
    const response = await fetch(uri);
    if (!response.ok) return null;
    const metadata = await response.json();
    return typeof metadata?.image === "string" ? metadata.image : null;
  } catch {
    return null;
  }
}

async function recordMint(
  admin: Admin,
  userId: string,
  collectionId: string,
  assetAddress: string,
  signature: string
): Promise<Response> {
  const { data: collection, error: collectionError } = await admin
    .from("collections")
    .select(
      "id, name, description, cover_url, collection_address, creator_id, candy_machines(id, candy_machine_address, prefix_uri, items_available)"
    )
    .eq("id", collectionId)
    .maybeSingle();
  if (collectionError) throw new Error(`Failed to load the collection: ${collectionError.message}`);
  if (!collection) return json(404, { error: "Collection not found." });

  const machine = Array.isArray(collection.candy_machines)
    ? collection.candy_machines[0]
    : collection.candy_machines;
  if (!machine) return json(409, { error: "This collection has no candy machine." });
  if (!collection.collection_address) {
    return json(409, { error: "This collection isn't on chain yet." });
  }

  const buyerWallet = await walletOf(admin, userId);
  if (!buyerWallet) return json(409, { error: "Your profile has no wallet address." });

  // Already recorded (a retried call, or two tabs racing) — hand back the same row.
  const { data: existing } = await admin
    .from("nfts")
    .select("id")
    .eq("asset_address", assetAddress)
    .maybeSingle();
  if (existing) return json(200, { nftId: existing.id, alreadyRecorded: true });

  const { umi, rpcUrl } = getUmi();

  // 1. The transaction: it landed, the caller paid for it, and it touched this machine and asset.
  const tx = await rpcCall(rpcUrl, "getTransaction", [
    signature,
    { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 0 },
  ]);
  if (!tx) return json(409, { error: "Transaction not found or not confirmed yet." });
  if (tx.meta?.err) return json(409, { error: "Transaction failed on chain." });
  const accountKeys: string[] = tx.transaction.message.accountKeys;
  if (accountKeys[0] !== buyerWallet) {
    return json(409, { error: "That mint was not paid for by your wallet." });
  }
  if (!accountKeys.includes(assetAddress) || !accountKeys.includes(machine.candy_machine_address)) {
    return json(409, { error: "That transaction is not a mint from this drop." });
  }

  // 2. The asset: it exists, the caller owns it, and it belongs to this collection — which only
  //    the candy machine could have arranged.
  let asset;
  try {
    asset = await fetchAsset(umi, publicKey(assetAddress));
  } catch {
    return json(409, { error: "Asset not found on chain yet." });
  }
  if (asset.owner !== buyerWallet) {
    return json(409, { error: "That item is not owned by your wallet." });
  }
  if (asset.updateAuthority.type !== "Collection" || asset.updateAuthority.address !== collection.collection_address) {
    return json(409, { error: "That item does not belong to this collection." });
  }
  if (machine.prefix_uri && !asset.uri.startsWith(machine.prefix_uri)) {
    return json(409, { error: "That item's metadata does not belong to this drop." });
  }

  // What the creator actually received, straight from the balance change, so the activity records
  // the real number rather than the phase price the client claims it paid.
  const creatorWallet = await walletOf(admin, collection.creator_id);
  const creatorIndex = creatorWallet ? accountKeys.indexOf(creatorWallet) : -1;
  const paid =
    creatorIndex >= 0
      ? BigInt(tx.meta.postBalances[creatorIndex]) - BigInt(tx.meta.preBalances[creatorIndex])
      : 0n;

  const imageUrl = (await imageFromMetadata(asset.uri)) ?? collection.cover_url;
  if (!imageUrl) return json(409, { error: "That item has no artwork to record." });

  const { data: nft, error: insertError } = await admin
    .from("nfts")
    .insert({
      asset_address: assetAddress,
      collection_id: collection.id,
      creator_id: collection.creator_id,
      owner_id: userId,
      owner_wallet: buyerWallet,
      name: asset.name,
      description: collection.description,
      image_url: imageUrl,
      metadata_url: asset.uri,
      edition_number: itemNumberFromName(asset.name),
      mint_tx: signature,
    })
    .select("id")
    .single();
  if (insertError) {
    // Lost a race with a concurrent recording of the same asset.
    if (insertError.code === "23505") {
      const { data: raced } = await admin.from("nfts").select("id").eq("asset_address", assetAddress).maybeSingle();
      if (raced) return json(200, { nftId: raced.id, alreadyRecorded: true });
    }
    return json(500, { error: insertError.message });
  }

  await admin.from("activities").insert({
    type: "mint",
    nft_id: nft.id,
    actor_id: userId,
    counterparty_id: collection.creator_id === userId ? null : collection.creator_id,
    lamports: paid > 0n ? paid.toString() : null,
    tx_signature: signature,
  });

  // Redeemed count is a cache of the machine's own counter. Count by metadata prefix rather than
  // by collection: a collection can also hold items its creator pre-minted before deploying a
  // machine, and those were never redeemed from it.
  const { count } = await admin
    .from("nfts")
    .select("id", { count: "exact", head: true })
    .eq("collection_id", collection.id)
    .like("metadata_url", `${machine.prefix_uri}%`);
  await admin
    .from("candy_machines")
    .update({ items_redeemed: Math.min(count ?? 0, machine.items_available) })
    .eq("id", machine.id);

  return json(200, { nftId: nft.id, name: asset.name, itemNumber: itemNumberFromName(asset.name) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json(401, { error: "Sign in to continue." });

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    if (
      typeof body.collectionId !== "string" ||
      typeof body.assetAddress !== "string" ||
      typeof body.signature !== "string"
    ) {
      return json(400, { error: "collectionId, assetAddress and signature are required." });
    }
    return await recordMint(admin, user.id, body.collectionId, body.assetAddress, body.signature);
  } catch (e) {
    console.error(e);
    return json(500, { error: e instanceof Error ? e.message : "Recording the mint failed." });
  }
});

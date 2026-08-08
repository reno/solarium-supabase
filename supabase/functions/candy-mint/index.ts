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

function itemNumberFromName(name: string): number | null {
  const match = /#\s*(\d+)\s*$/.exec(name);
  return match ? Number(match[1]) : null;
}

type ItemMetadata = { image: string | null; traits: { trait: string; value: string }[] };

// The item's metadata JSON is the only place its artwork and attributes exist — the config line
// carries just a URI. Traits are what recompute_collection_rarity ranks, so a drop that ships
// per-item attributes gets real rarity; one that doesn't gets an empty array and a null rank,
// which is the honest answer rather than a rank derived from nothing.
async function readMetadata(uri: string): Promise<ItemMetadata> {
  try {
    const response = await fetch(uri);
    if (!response.ok) return { image: null, traits: [] };
    const metadata = await response.json();
    const attributes = Array.isArray(metadata?.attributes) ? metadata.attributes : [];
    const traits = attributes
      .map((a: { trait_type?: unknown; trait?: unknown; value?: unknown }) => ({
        trait: String(a?.trait_type ?? a?.trait ?? ""),
        value: String(a?.value ?? ""),
      }))
      .filter((t: { trait: string; value: string }) => t.trait !== "" && t.value !== "");
    return { image: typeof metadata?.image === "string" ? metadata.image : null, traits };
  } catch {
    return { image: null, traits: [] };
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

  const { data: existing } = await admin
    .from("nfts")
    .select("id")
    .eq("asset_address", assetAddress)
    .maybeSingle();
  if (existing) return json(200, { nftId: existing.id, alreadyRecorded: true });

  const { umi, rpcUrl } = getUmi();

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

  const creatorWallet = await walletOf(admin, collection.creator_id);
  const creatorIndex = creatorWallet ? accountKeys.indexOf(creatorWallet) : -1;
  const paid =
    creatorIndex >= 0
      ? BigInt(tx.meta.postBalances[creatorIndex]) - BigInt(tx.meta.preBalances[creatorIndex])
      : 0n;

  const metadata = await readMetadata(asset.uri);
  const imageUrl = metadata.image ?? collection.cover_url;
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
      item_number: itemNumberFromName(asset.name),
      traits: metadata.traits,
      mint_tx: signature,
    })
    .select("id")
    .single();
  if (insertError) {
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

  // Rarity is relative to the rest of the collection, so it is re-ranked as each item lands.
  if (metadata.traits.length > 0) {
    const { error: rarityError } = await admin.rpc("recompute_collection_rarity", { p_collection: collection.id });
    if (rarityError) console.error(`recompute_collection_rarity(${collection.id}) failed: ${rarityError.message}`);
  }

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

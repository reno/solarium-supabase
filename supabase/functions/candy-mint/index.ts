import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import { publicKey, type Umi } from "npm:@metaplex-foundation/umi@1.5.1";
import { createUmi } from "npm:@metaplex-foundation/umi-bundle-defaults@1.5.1";
import { fetchAsset, mplCore } from "npm:@metaplex-foundation/mpl-core@1.10.0";

import { rpcCallForResult } from "../_shared/rpc.ts";
import { internalStorageUrl, isMarketplaceStorageUrl } from "../_shared/storage.ts";
import { isBase58, isUuid } from "../_shared/tx.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BODY_BYTES = 4096;
const MAX_METADATA_BYTES = 256 * 1024;
const METADATA_TIMEOUT_MS = 5000;
const MAX_TRAITS = 64;
const MAX_TRAIT_FIELD = 128;
const MAX_ITEM_NUMBER = 1_000_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(status: number, message: string, cause?: unknown): Response {
  if (cause !== undefined) console.error(`[candy-mint] ${message}`, cause);
  return json(status, { error: message });
}

function getUmi(): { umi: Umi; rpcUrl: string } {
  const rpcUrl = Deno.env.get("SOLANA_RPC_URL");
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL is not configured");
  return { umi: createUmi(rpcUrl).use(mplCore()), rpcUrl };
}

type Admin = ReturnType<typeof createClient>;

async function walletOf(admin: Admin, userId: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("wallet_address").eq("id", userId).maybeSingle();
  return data?.wallet_address ?? null;
}

function itemNumberFromName(name: string): number | null {
  const match = /#\s*(\d{1,9})\s*$/.exec(name);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_ITEM_NUMBER ? n : null;
}

type ItemMetadata = { image: string | null; traits: { trait: string; value: string }[] };

async function readMetadata(uri: string): Promise<ItemMetadata> {
  const empty: ItemMetadata = { image: null, traits: [] };
  if (!isMarketplaceStorageUrl(uri)) {
    console.warn(`[candy-mint] not fetching metadata hosted outside storage: ${uri}`);
    return empty;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
  try {
    const response = await fetch(internalStorageUrl(uri), { signal: controller.signal, redirect: "error" });
    if (!response.ok) return empty;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_METADATA_BYTES) return empty;
    const text = await response.text();
    if (text.length > MAX_METADATA_BYTES) return empty;

    const metadata = JSON.parse(text);
    const attributes = Array.isArray(metadata?.attributes) ? metadata.attributes : [];
    const traits = attributes
      .slice(0, MAX_TRAITS)
      .map((a: { trait_type?: unknown; trait?: unknown; value?: unknown }) => ({
        trait: String(a?.trait_type ?? a?.trait ?? "").slice(0, MAX_TRAIT_FIELD),
        value: String(a?.value ?? "").slice(0, MAX_TRAIT_FIELD),
      }))
      .filter((t: { trait: string; value: string }) => t.trait !== "" && t.value !== "");
    const image = isMarketplaceStorageUrl(metadata?.image) ? metadata.image : null;
    return { image, traits };
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

const ASSET_LOOKUP_ATTEMPTS = 5;

async function fetchAssetWhenVisible(umi: Umi, assetAddress: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchAsset(umi, publicKey(assetAddress));
    } catch (e) {
      if (attempt >= ASSET_LOOKUP_ATTEMPTS) {
        console.warn(`[candy-mint] ${assetAddress} still not visible after ${attempt} attempts`, e);
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
}

type ExistingNft = {
  id: string;
  image_url: string | null;
  metadata_url: string | null;
  traits: unknown;
};

type CollectionForHeal = {
  id: string;
  cover_url: string | null;
  reveal_at: string | null;
};

async function healPlaceholderRow(
  admin: Admin,
  collection: CollectionForHeal,
  row: ExistingNft
): Promise<boolean> {
  if (collection.reveal_at !== null) return false;
  const traitCount = Array.isArray(row.traits) ? row.traits.length : 0;
  const looksLikeFallback = traitCount === 0 || row.image_url === collection.cover_url;
  if (!looksLikeFallback || !row.metadata_url) return false;

  const metadata = await readMetadata(row.metadata_url);
  const patch: Record<string, unknown> = {};
  if (metadata.image && metadata.image !== row.image_url) patch.image_url = metadata.image;
  if (metadata.traits.length > 0 && traitCount === 0) patch.traits = metadata.traits;
  if (Object.keys(patch).length === 0) return false;

  const { error } = await admin.from("nfts").update(patch).eq("id", row.id);
  if (error) {
    console.error(`[candy-mint] could not heal ${row.id}`, error);
    return false;
  }
  console.log(`[candy-mint] healed ${row.id} from ${row.metadata_url}`);
  return true;
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
      "id, name, description, cover_url, collection_address, creator_id, reveal_at, candy_machines(id, candy_machine_address, prefix_uri, items_available)"
    )
    .eq("id", collectionId)
    .maybeSingle();
  if (collectionError) return fail(500, "Could not load the collection.", collectionError);
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
    .select("id, image_url, metadata_url, traits")
    .eq("asset_address", assetAddress)
    .maybeSingle();
  if (existing) {
    const healed = await healPlaceholderRow(
      admin,
      collection as unknown as CollectionForHeal,
      existing as unknown as ExistingNft
    );
    return json(200, { nftId: existing.id, alreadyRecorded: true, healed });
  }

  const { umi, rpcUrl } = getUmi();

  const tx = await rpcCallForResult(rpcUrl, "getTransaction", [
    signature,
    { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 0 },
  ]);
  if (!tx) return json(409, { error: "Transaction not found or not confirmed yet." });
  if (tx.meta?.err) return json(409, { error: "Transaction failed on chain." });
  if (!tx.meta?.preBalances || !tx.meta?.postBalances) {
    return json(409, { error: "Transaction is missing execution details." });
  }

  const accountKeys: string[] = tx.transaction?.message?.accountKeys ?? [];
  if (accountKeys[0] !== buyerWallet) {
    return json(409, { error: "That mint was not paid for by your wallet." });
  }
  const assetIndex = accountKeys.indexOf(assetAddress);
  if (assetIndex < 0 || !accountKeys.includes(machine.candy_machine_address)) {
    return json(409, { error: "That transaction is not a mint from this drop." });
  }
  const assetPre = BigInt(tx.meta.preBalances[assetIndex] ?? 0);
  const assetPost = BigInt(tx.meta.postBalances[assetIndex] ?? 0);
  if (assetPre !== 0n || assetPost === 0n) {
    return json(409, { error: "That transaction did not mint this item." });
  }

  const asset = await fetchAssetWhenVisible(umi, assetAddress);
  if (!asset) {
    return json(409, {
      error: "That item hasn't appeared on chain yet. Reload the drop page in a moment to finish recording it.",
    });
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
  if (!isMarketplaceStorageUrl(asset.uri)) {
    console.warn(`[candy-mint] recording ${assetAddress} with off-marketplace metadata: ${asset.uri}`);
  }

  const creatorWallet = await walletOf(admin, collection.creator_id);
  const creatorIndex = creatorWallet ? accountKeys.indexOf(creatorWallet) : -1;
  const paid =
    creatorIndex >= 0
      ? BigInt(tx.meta.postBalances[creatorIndex] ?? 0) - BigInt(tx.meta.preBalances[creatorIndex] ?? 0)
      : 0n;

  const metadata = await readMetadata(asset.uri);
  const imageUrl = metadata.image ?? collection.cover_url;
  if (!imageUrl) return json(409, { error: "That item has no artwork to record." });

  const itemNumber = itemNumberFromName(asset.name);

  const unrevealed = collection.reveal_at !== null;
  let planned: { rarity_rank: number; rarity_total: number } | null = null;
  if (!unrevealed && itemNumber != null) {
    const { data } = await admin
      .from("collection_item_rarity")
      .select("rarity_rank, rarity_total")
      .eq("collection_id", collection.id)
      .eq("item_number", itemNumber)
      .maybeSingle();
    planned = data as { rarity_rank: number; rarity_total: number } | null;
  }

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
      item_number: itemNumber,
      traits: metadata.traits,
      rarity_rank: planned?.rarity_rank ?? null,
      rarity_total: planned?.rarity_total ?? null,
      mint_tx: signature,
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: raced } = await admin.from("nfts").select("id").eq("asset_address", assetAddress).maybeSingle();
      if (raced) return json(200, { nftId: raced.id, alreadyRecorded: true });
    }
    return fail(500, "Could not record this mint.", insertError);
  }

  await admin.from("activities").insert({
    type: "mint",
    nft_id: nft.id,
    actor_id: userId,
    counterparty_id: collection.creator_id === userId ? null : collection.creator_id,
    lamports: paid > 0n ? paid.toString() : null,
    tx_signature: signature,
  });

  if (planned === null && !unrevealed && metadata.traits.length > 0) {
    const { count: plannedRows } = await admin
      .from("collection_item_rarity")
      .select("item_number", { count: "exact", head: true })
      .eq("collection_id", collection.id);
    if (!plannedRows) {
      const { error: rarityError } = await admin.rpc("recompute_collection_rarity", { p_collection: collection.id });
      if (rarityError) console.error(`recompute_collection_rarity(${collection.id}) failed: ${rarityError.message}`);
    }
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

  return json(200, { nftId: nft.id, name: asset.name, itemNumber });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return json(413, { error: "Request body too large." });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json(401, { error: "Sign in to continue." });

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: "Request body too large." });
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json(400, { error: "Malformed request." });
    }

    if (!isUuid(body.collectionId) || !isBase58(body.assetAddress) || !isBase58(body.signature)) {
      return json(400, { error: "collectionId, assetAddress and signature are required." });
    }
    return await recordMint(admin, user.id, body.collectionId, body.assetAddress, body.signature);
  } catch (e) {
    console.error("[candy-mint] unhandled", e);
    return json(500, { error: "Recording the mint failed. Please try again." });
  }
});

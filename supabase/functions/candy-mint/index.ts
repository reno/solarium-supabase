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
// Item metadata is a small JSON document; anything larger is not one of ours.
const MAX_METADATA_BYTES = 256 * 1024;
const METADATA_TIMEOUT_MS = 5000;
const MAX_TRAITS = 64;
const MAX_TRAIT_FIELD = 128;
// item_number is an integer column and a config-line index. Beyond this, Number() starts losing
// precision and the value is meaningless anyway.
const MAX_ITEM_NUMBER = 1_000_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Raw Postgres and RPC error text names columns, constraints, policies and the provider
// endpoint. Log it; return a sentence.
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

// The item's metadata JSON is the only place its artwork and attributes exist — the config line
// carries just a URI. Traits are what recompute_collection_rarity ranks, so a drop that ships
// per-item attributes gets real rarity; one that doesn't gets an empty array and a null rank,
// which is the honest answer rather than a rank derived from nothing.
async function readMetadata(uri: string): Promise<ItemMetadata> {
  const empty: ItemMetadata = { image: null, traits: [] };
  // This is the SSRF guard: an asset's uri is on-chain data, and fetching it server-side without
  // checking would hand the caller the edge function's network position. Everything else about
  // an off-marketplace uri is tolerated (see recordMint) — what is not tolerated is fetching it.
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

/**
 * Read the freshly minted asset, allowing for the node not having caught up yet.
 *
 * The buyer's client waits for the account before calling this — but on *its* RPC connection.
 * This function reads over a different one (SOLANA_RPC_URL, a separate server-side endpoint by
 * design), and a brand-new account does not appear on every node at the same instant. A single
 * lookup therefore turns a perfectly good mint into "asset not found", which strands a buyer who
 * has already paid and leaves them to retry by hand.
 *
 * `rpcCall` already retries transport failures, but `fetchAsset` goes through umi's own fetch and
 * never sees any of that — so the one call that most needs "not yet, look again" had none.
 * Bounded at roughly eight seconds: long enough for propagation, short enough that a genuinely
 * missing account still answers promptly.
 */
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

/**
 * Repair a row that was recorded while its metadata could not be read.
 *
 * `readMetadata` fails soft by design — a mint must be recorded even if the JSON behind it is
 * momentarily unreachable, because the alternative is a buyer who paid and owns nothing the app
 * can see. The cost is a row holding the collection cover and no traits, and since recording is
 * idempotent on the asset address, a retry used to return that row unchanged: the item stayed
 * wrong permanently.
 *
 * So a retry now re-reads the metadata and fills in what it missed. Cheap, because it only runs
 * for rows that actually look like a fallback, and safe to repeat.
 *
 * Deliberately skipped while `reveal_at` is set: there the placeholder *is* the intended content,
 * and `reveal` is what replaces it.
 */
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
  // meta is optional on the RPC response; the balance arrays below are not safe to reach into
  // until it is known to be there.
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
  // The asset account was created by this transaction: it held nothing before and is rent-funded
  // after. Naming an address in the key list is something any transaction can do; bringing the
  // account into existence is not, so this is what ties the signature to *this* mint rather than
  // to some unrelated transaction that merely mentioned the same addresses.
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
  // Deliberately *not* a refusal. Where the metadata is hosted says nothing about whether this
  // mint is genuine — that is settled above by the on-chain owner, the update authority matching
  // the collection, the drop's own prefix_uri, and the asset account having been created by this
  // very transaction. Refusing here would leave a buyer who has already paid holding an item the
  // app will not record, which is the one outcome this function must never produce. An
  // off-marketplace uri simply does not get fetched (readMetadata declines it), so the item is
  // recorded against the collection cover with no traits.
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

  // Rarity for a manifest-based drop was ranked over the whole pool when the drop was created,
  // so it is a lookup rather than a recount — see collection_item_rarity. Withheld entirely
  // while the drop is unrevealed (reveal_at non-null), because handing a buyer their rank would
  // give away what the placeholder art is hiding; the `reveal` function backfills it.
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

  // Only for legacy drops with no planned ranking: this re-ranks over the items minted so far,
  // which is a moving target until sellout. The count is what decides, not the lookup above — a
  // single miss (a read blip, an item the manifest didn't rank) must not send a planned drop
  // down this path and overwrite every rank it already had.
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

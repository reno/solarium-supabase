/**
 * reveal — publish a delayed-reveal drop's real artwork and traits.
 *
 * Nothing on chain changes. A drop's item metadata lives in a Supabase Storage bucket that the
 * on-chain URIs point at, so revealing is just rewriting those `{n}.json` files with what the
 * manifest said all along, then backfilling the `nfts` rows minted while they were placeholders.
 * No transaction, no signature, no candy machine `hiddenSettings`.
 *
 * Not gated on being the creator, deliberately. It runs only once `reveal_at` has passed, and
 * what it writes is fully determined by a manifest that is already public — so there is nothing
 * for a caller to influence, and a creator who goes quiet can't leave a drop hidden forever.
 * Early reveal is refused for everyone, including the creator: revealing mid-mint would hand the
 * remaining buyers exactly the rarity map the delay exists to withhold.
 *
 * That "nothing for a caller to influence" argument used to have two gaps, both closed here.
 * The manifest was re-fetched from a public URL at call time and the creator could rewrite it
 * whenever they liked, so it was only settled as of the instant of the call — it is now pinned
 * by hash at deploy, and the drop's storage folder is frozen once its candy machine exists. And
 * the reveal_at flag was cleared last, with no claim, so every concurrent caller ran the whole
 * body: it is now claimed atomically up front and restored if the work fails.
 */
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

import { dropFolder, manifestPath, parseManifest, MEDIA_BUCKET } from "../_shared/manifest.ts";
import { buildNftMetadata } from "../_shared/metadata.ts";
import { isMarketplaceStorageUrl } from "../_shared/storage.ts";
import { isUuid, sha256Hex } from "../_shared/tx.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BODY_BYTES = 4096;
// A 250-item manifest with traits is tens of KB. This is generous headroom that still bounds
// what an oversized file can cost us before parseManifest gets to reject it on item count.
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MANIFEST_TIMEOUT_MS = 10_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(status: number, message: string, cause?: unknown): Response {
  if (cause !== undefined) console.error(`[reveal] ${message}`, cause);
  return json(status, { error: message });
}

type Admin = ReturnType<typeof createClient>;

// Storage and Postgres both go one row at a time here; a small pool keeps a 250-item reveal to
// seconds without opening 250 sockets at once.
const CONCURRENCY = 6;

async function pooled<T>(items: readonly T[], worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  let stopped = false;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (!stopped && cursor < items.length) {
        const item = items[cursor++];
        try {
          await worker(item);
        } catch (e) {
          stopped = true;
          throw e;
        }
      }
    })
  );
}

async function fetchManifest(url: string): Promise<{ text: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_MANIFEST_BYTES) return null;
    const text = await response.text();
    if (text.length > MAX_MANIFEST_BYTES) return null;
    return { text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function reveal(admin: Admin, collectionId: string): Promise<Response> {
  const { data: collection, error: collectionError } = await admin
    .from("collections")
    .select("id, name, description, creator_id, reveal_at, candy_machines(prefix_name, manifest_sha256)")
    .eq("id", collectionId)
    .maybeSingle();
  if (collectionError) return fail(500, "Could not load the collection.", collectionError);
  if (!collection) return json(404, { error: "Collection not found." });

  // reveal_at null is the schema's "revealed" — so a second call is a no-op, not an error.
  if (collection.reveal_at === null) return json(200, { alreadyRevealed: true, items: 0 });
  if (new Date(collection.reveal_at).getTime() > Date.now()) {
    return json(409, { error: "This drop's reveal time hasn't arrived yet." });
  }

  // Claim the reveal. The predicates re-check both conditions inside the same statement, so
  // concurrent callers past the checks above resolve to exactly one winner rather than all
  // running the full body — which, before, meant N manifest fetches and N × supply storage
  // writes for anyone willing to fire N requests the second the deadline passed.
  const revealAt = collection.reveal_at as string;
  const { data: claimed, error: claimError } = await admin
    .from("collections")
    .update({ reveal_at: null })
    .eq("id", collection.id)
    .not("reveal_at", "is", null)
    .lte("reveal_at", new Date().toISOString())
    .select("id");
  if (claimError) return fail(500, "Could not start the reveal.", claimError);
  if (!claimed || claimed.length === 0) {
    return json(200, { alreadyRevealed: true, items: 0 });
  }

  // From here the drop is marked revealed. Any failure puts the flag back, so the call stays
  // retryable exactly as it was when the clear happened last.
  const restore = async () => {
    const { error } = await admin
      .from("collections")
      .update({ reveal_at: revealAt })
      .eq("id", collection.id)
      .is("reveal_at", null);
    if (error) console.error(`[reveal] could not restore reveal_at for ${collection.id}`, error);
  };

  try {
    const machine = Array.isArray(collection.candy_machines)
      ? collection.candy_machines[0]
      : collection.candy_machines;
    const folder = dropFolder(collection.creator_id as string, collection.id as string);

    const manifestUrl = admin.storage.from(MEDIA_BUCKET).getPublicUrl(manifestPath(folder)).data.publicUrl;
    const fetched = await fetchManifest(manifestUrl);
    if (!fetched) {
      await restore();
      return json(409, { error: "This drop has no item manifest, so there is nothing to reveal." });
    }

    // The manifest is pinned at deploy. The folder is frozen from that same moment, so this
    // should never fire — it is here because "should never" is not the same as "cannot", and
    // rewriting every buyer's artwork off a swapped manifest is not a failure worth discovering
    // afterwards.
    const pinned = machine?.manifest_sha256 as string | null | undefined;
    if (pinned) {
      const actual = await sha256Hex(new TextEncoder().encode(fetched.text));
      if (actual !== pinned) {
        await restore();
        return fail(
          409,
          "This drop's item manifest has changed since it was deployed, so it cannot be revealed.",
          { collectionId: collection.id, expected: pinned, actual }
        );
      }
    }

    let manifest;
    try {
      manifest = parseManifest(JSON.parse(fetched.text));
    } catch (e) {
      await restore();
      return fail(409, "This drop's item manifest could not be read.", e);
    }

    // Item artwork is written into nfts.image_url and into the metadata JSON the whole app
    // renders from. It must point at our own storage, not at somewhere a manifest author chose.
    // Unlike candy-mint's equivalent, refusing here is right: this function *writes* these URLs,
    // so an off-marketplace one becomes what every holder sees, and nothing has been paid for
    // yet that a refusal could strand.
    const offOrigin = manifest.items.find((item) => !isMarketplaceStorageUrl(item.image));
    if (offOrigin) {
      await restore();
      return fail(409, "This drop's item artwork is not hosted by this marketplace.", offOrigin.image);
    }

    // The names are already on chain (prefix + config line), so reveal must reproduce them
    // exactly rather than invent new ones.
    const prefixName = machine?.prefix_name ?? `${collection.name} #`;

    const { data: mintedRows, error: mintedError } = await admin
      .from("nfts")
      .select("id, item_number")
      .eq("collection_id", collection.id)
      .not("item_number", "is", null);
    if (mintedError) {
      await restore();
      return fail(500, "Could not load this drop's items.", mintedError);
    }
    const mintedByNumber = new Map<number, string>(
      (mintedRows ?? []).map((row) => [row.item_number as number, row.id as string])
    );

    const { data: rarityRows } = await admin
      .from("collection_item_rarity")
      .select("item_number, rarity_rank, rarity_total")
      .eq("collection_id", collection.id);
    const rarityByNumber = new Map(
      (rarityRows ?? []).map((row) => [row.item_number as number, row])
    );

    let rewritten = 0;
    let backfilled = 0;

    await pooled(manifest.items, async (item) => {
      const body = JSON.stringify(
        buildNftMetadata({
          name: `${prefixName}${item.index}`,
          description: collection.description as string | null,
          imageUrl: item.image,
          imageType: item.imageType,
          attributes: item.traits.map(({ trait, value }) => ({ trait_type: trait, value })),
        }),
        null,
        2
      );
      const { error: uploadError } = await admin.storage
        .from(MEDIA_BUCKET)
        .upload(`${folder}/${item.index}.json`, new Blob([body], { type: "application/json" }), {
          contentType: "application/json",
          upsert: true,
        });
      if (uploadError) throw new Error(`Rewriting item ${item.index} failed: ${uploadError.message}`);
      rewritten++;

      // Items minted while hidden were recorded with the placeholder art and no traits, and their
      // rarity was withheld. Now that the pool is public, give them all three.
      const nftId = mintedByNumber.get(item.index);
      if (!nftId) return;
      const rarity = rarityByNumber.get(item.index);
      const { error: updateError } = await admin
        .from("nfts")
        .update({
          image_url: item.image,
          traits: item.traits,
          rarity_rank: rarity?.rarity_rank ?? null,
          rarity_total: rarity?.rarity_total ?? null,
        })
        .eq("id", nftId);
      if (updateError) throw new Error(`Updating item ${item.index} failed: ${updateError.message}`);
      backfilled++;
    });

    // A drop with no rarity table (no traits) still needs its ranks settled the old way.
    if (rarityByNumber.size === 0 && manifest.items.some((item) => item.traits.length > 0)) {
      const { error: rarityError } = await admin.rpc("recompute_collection_rarity", { p_collection: collection.id });
      if (rarityError) console.error(`recompute_collection_rarity(${collection.id}) failed: ${rarityError.message}`);
    }

    return json(200, { revealed: true, items: rewritten, backfilled });
  } catch (e) {
    await restore();
    return fail(500, "Revealing the drop failed. Please try again.", e);
  }
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

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: "Request body too large." });
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json(400, { error: "Malformed request." });
    }
    if (!isUuid(body.collectionId)) {
      return json(400, { error: "collectionId is required." });
    }
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    return await reveal(admin, body.collectionId);
  } catch (e) {
    console.error("[reveal] unhandled", e);
    return json(500, { error: "Revealing the drop failed. Please try again." });
  }
});

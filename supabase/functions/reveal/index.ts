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
 */
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

import { dropFolder, manifestPath, parseManifest, MEDIA_BUCKET } from "../_shared/manifest.ts";
import { buildNftMetadata } from "../_shared/metadata.ts";

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

async function reveal(admin: Admin, collectionId: string): Promise<Response> {
  const { data: collection, error: collectionError } = await admin
    .from("collections")
    .select("id, name, description, creator_id, reveal_at, candy_machines(prefix_name)")
    .eq("id", collectionId)
    .maybeSingle();
  if (collectionError) throw new Error(`Failed to load the collection: ${collectionError.message}`);
  if (!collection) return json(404, { error: "Collection not found." });

  // reveal_at null is the schema's "revealed" — so a second call is a no-op, not an error.
  if (collection.reveal_at === null) return json(200, { alreadyRevealed: true, items: 0 });
  if (new Date(collection.reveal_at).getTime() > Date.now()) {
    return json(409, { error: "This drop's reveal time hasn't arrived yet." });
  }

  const machine = Array.isArray(collection.candy_machines) ? collection.candy_machines[0] : collection.candy_machines;
  const folder = dropFolder(collection.creator_id, collection.id);

  const manifestUrl = admin.storage.from(MEDIA_BUCKET).getPublicUrl(manifestPath(folder)).data.publicUrl;
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) {
    return json(409, { error: "This drop has no item manifest, so there is nothing to reveal." });
  }
  const manifest = parseManifest(await response.json());

  // The names are already on chain (prefix + config line), so reveal must reproduce them
  // exactly rather than invent new ones.
  const prefixName = machine?.prefix_name ?? `${collection.name} #`;

  const { data: mintedRows, error: mintedError } = await admin
    .from("nfts")
    .select("id, item_number")
    .eq("collection_id", collection.id)
    .not("item_number", "is", null);
  if (mintedError) throw new Error(`Failed to load this drop's items: ${mintedError.message}`);
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

  // Last, so a failure part-way leaves the drop still marked unrevealed and the call retryable.
  const { error: clearError } = await admin
    .from("collections")
    .update({ reveal_at: null })
    .eq("id", collection.id);
  if (clearError) throw new Error(`Items were revealed but clearing the reveal time failed: ${clearError.message}`);

  // A drop with no rarity table (no traits) still needs its ranks settled the old way.
  if (rarityByNumber.size === 0 && manifest.items.some((item) => item.traits.length > 0)) {
    const { error: rarityError } = await admin.rpc("recompute_collection_rarity", { p_collection: collection.id });
    if (rarityError) console.error(`recompute_collection_rarity(${collection.id}) failed: ${rarityError.message}`);
  }

  return json(200, { revealed: true, items: rewritten, backfilled });
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

    const body = await req.json();
    if (typeof body.collectionId !== "string") {
      return json(400, { error: "collectionId is required." });
    }
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    return await reveal(admin, body.collectionId);
  } catch (e) {
    console.error(e);
    return json(500, { error: e instanceof Error ? e.message : "Revealing the drop failed." });
  }
});

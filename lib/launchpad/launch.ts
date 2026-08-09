import type { SupabaseClient } from "@supabase/supabase-js";

import { addAllowlist, createPhase } from "@/lib/launchpad/manage";
import {
  buildManifest,
  dropFolder,
  extensionOf,
  itemImagePath,
  manifestPath,
  orderItemFiles,
  rankManifest,
  type ManifestTrait,
} from "@/lib/launchpad/manifest";
import { publicUrl, runPooled, uploadJson, uploadTo, type Progress } from "@/lib/launchpad/upload";
import { assertUploadableImage } from "@/lib/media/validate";

export type LaunchPhaseInput = {
  name: string;
  priceLamports: bigint;
  startsAt: string;
  endsAt: string | null;
  perWalletLimit: number | null;
  allowlistOnly: boolean;
};

export type NewLaunch = {
  creatorId: string;
  name: string;
  description: string | null;
  cover: File;
  banner: File | null;
  // One image per item. File order is item order — see orderItemFiles.
  items: File[];
  // Keyed by 1-based item number. Null for a drop that ships no traits, which is allowed: the
  // items are still unique art, they just get no rarity ranking.
  traits: Map<number, ManifestTrait[]> | null;
  royaltyBps: number;
  revealAt: string | null;
  phases: LaunchPhaseInput[];
  allowlistWallets: string[];
};

export type LaunchProgress = (stage: "artwork" | "items" | "manifest" | "record", done: number, total: number) => void;

// Matches the CHECK constraints on `collections`, and the base58 shape a Solana address has.
// The wizard applies most of these as maxLength attributes, which is a UI affordance rather
// than a rule — createLaunch is a plain exported function and nothing stops a caller reaching it
// directly, so the rule belongs here too.
const MAX_NAME = 100;
const MAX_DESCRIPTION = 2000;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function assertLaunchText(launch: NewLaunch): void {
  const name = launch.name.trim();
  if (name.length < 1 || name.length > MAX_NAME) {
    throw new Error(`The drop name must be between 1 and ${MAX_NAME} characters.`);
  }
  if ((launch.description?.length ?? 0) > MAX_DESCRIPTION) {
    throw new Error(`The description must be ${MAX_DESCRIPTION} characters or fewer.`);
  }
  if (!Number.isInteger(launch.royaltyBps) || launch.royaltyBps < 0 || launch.royaltyBps > 10000) {
    throw new Error("The creator royalty must be between 0% and 100%.");
  }
  if (launch.items.length < 1) {
    throw new Error("A drop needs at least one item.");
  }
  for (const phase of launch.phases) {
    if (phase.priceLamports < 0n) throw new Error(`Phase "${phase.name}" has a negative price.`);
    if (phase.perWalletLimit !== null && phase.perWalletLimit < 1) {
      throw new Error(`Phase "${phase.name}" has a per-wallet limit below 1.`);
    }
  }
  for (const wallet of launch.allowlistWallets) {
    if (!BASE58_ADDRESS.test(wallet)) {
      throw new Error(`"${wallet}" is not a valid Solana wallet address.`);
    }
  }
}

export async function createLaunch(
  supabase: SupabaseClient,
  launch: NewLaunch,
  onProgress?: LaunchProgress
): Promise<string> {
  // The collection id is minted here rather than by the database so it can name the storage
  // folder, which is what lets the deploy step find these uploads later without a column
  // recording where they went. The row is still inserted last: there is no delete policy on
  // collections, so a failed upload must not leave a drop nobody can clear away.
  const collectionId = crypto.randomUUID();
  const folder = dropFolder(launch.creatorId, collectionId);

  // Everything checkable is checked before a single byte is uploaded, for the same reason
  // buildManifest runs before the item loop below: a rejection discovered after 250 uploads is
  // the same rejection, found expensively. These limits also exist in the database and on the
  // storage buckets — this is where they become a sentence rather than a constraint violation.
  assertLaunchText(launch);
  const ordered = orderItemFiles(launch.items);
  await assertUploadableImage(launch.cover, "The cover image");
  if (launch.banner) await assertUploadableImage(launch.banner, "The banner image");
  for (const [position, file] of ordered.entries()) {
    await assertUploadableImage(file, `Item ${position + 1}`);
  }

  const step = (stage: Parameters<LaunchProgress>[0]): Progress => (done, total) => onProgress?.(stage, done, total);

  onProgress?.("artwork", 0, launch.banner ? 2 : 1);
  const coverUrl = await uploadTo(
    supabase,
    `${folder}/cover.${extensionOf(launch.cover.name, launch.cover.type)}`,
    launch.cover,
    launch.cover.type,
    "Artwork"
  );
  onProgress?.("artwork", 1, launch.banner ? 2 : 1);
  const bannerUrl = launch.banner
    ? await uploadTo(
        supabase,
        `${folder}/banner.${extensionOf(launch.banner.name, launch.banner.type)}`,
        launch.banner,
        launch.banner.type,
        "Banner"
      )
    : null;

  const images = ordered.map((file, position) => ({
    index: position + 1,
    url: publicUrl(supabase, itemImagePath(folder, position + 1, extensionOf(file.name, file.type))),
    type: file.type || "image/png",
  }));

  // Validate before uploading a single item: a supply/traits mismatch found after 250 uploads
  // is the same error, discovered expensively.
  const manifest = buildManifest({ images, traits: launch.traits });

  onProgress?.("items", 0, ordered.length);
  await runPooled(
    ordered,
    async (file, position) => {
      await uploadTo(
        supabase,
        itemImagePath(folder, position + 1, extensionOf(file.name, file.type)),
        file,
        file.type,
        `Item ${position + 1}`
      );
    },
    step("items")
  );

  onProgress?.("manifest", 0, 1);
  await uploadJson(supabase, manifestPath(folder), manifest, "Item manifest");
  onProgress?.("manifest", 1, 1);

  onProgress?.("record", 0, 1);
  const { data, error } = await supabase
    .from("collections")
    .insert({
      id: collectionId,
      creator_id: launch.creatorId,
      name: launch.name,
      description: launch.description,
      cover_url: coverUrl,
      banner_url: bannerUrl,
      royalty_bps: launch.royaltyBps,
      reveal_at: launch.revealAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create the drop: ${error.message}`);

  // Rarity is a property of the pool, and the pool is now fixed — so rank it here, once, rather
  // than letting recompute_collection_rarity re-rank a growing subset after every mint.
  const rarity = rankManifest(manifest);
  if (rarity.length > 0) {
    const { error: rarityError } = await supabase.from("collection_item_rarity").insert(
      rarity.map(({ index, score, rank, total }) => ({
        collection_id: data.id,
        item_number: index,
        rarity_score: score,
        rarity_rank: rank,
        rarity_total: total,
      }))
    );
    if (rarityError) throw new Error(`Could not record item rarity: ${rarityError.message}`);
  }

  if (launch.allowlistWallets.length > 0) {
    await addAllowlist(supabase, data.id, launch.allowlistWallets);
  }

  for (const [index, phase] of launch.phases.entries()) {
    await createPhase(supabase, {
      collectionId: data.id,
      name: phase.name,
      priceLamports: phase.priceLamports,
      startsAt: phase.startsAt,
      endsAt: phase.endsAt,
      perWalletLimit: phase.perWalletLimit,
      allowlistOnly: phase.allowlistOnly,
      position: index,
    });
  }
  onProgress?.("record", 1, 1);

  return data.id;
}

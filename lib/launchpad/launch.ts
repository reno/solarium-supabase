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

  const step = (stage: Parameters<LaunchProgress>[0]): Progress => (done, total) => onProgress?.(stage, done, total);

  onProgress?.("artwork", 0, launch.banner ? 2 : 1);
  const coverUrl = await uploadTo(
    supabase,
    `${folder}/cover.${extensionOf(launch.cover.name)}`,
    launch.cover,
    launch.cover.type || "image/png",
    "Artwork"
  );
  onProgress?.("artwork", 1, launch.banner ? 2 : 1);
  const bannerUrl = launch.banner
    ? await uploadTo(
        supabase,
        `${folder}/banner.${extensionOf(launch.banner.name)}`,
        launch.banner,
        launch.banner.type || "image/png",
        "Banner"
      )
    : null;

  const ordered = orderItemFiles(launch.items);
  const images = ordered.map((file, position) => ({
    index: position + 1,
    url: publicUrl(supabase, itemImagePath(folder, position + 1, extensionOf(file.name))),
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
        itemImagePath(folder, position + 1, extensionOf(file.name)),
        file,
        file.type || "image/png",
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

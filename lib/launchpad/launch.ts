import type { SupabaseClient } from "@supabase/supabase-js";

import { addAllowlist, createPhase } from "@/lib/launchpad/manage";

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
  royaltyBps: number;
  revealAt: string | null;
  phases: LaunchPhaseInput[];
  allowlistWallets: string[];
};

function extensionOf(file: File): string {
  return file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : "png";
}

async function uploadArtwork(
  supabase: SupabaseClient,
  file: File,
  path: string,
  label: string
): Promise<string> {
  const { error } = await supabase.storage
    .from("nft-media")
    .upload(path, file, { contentType: file.type || "image/png" });
  if (error) throw new Error(`${label} upload failed: ${error.message}`);
  return supabase.storage.from("nft-media").getPublicUrl(path).data.publicUrl;
}

export async function createLaunch(supabase: SupabaseClient, launch: NewLaunch): Promise<string> {
  const dropId = crypto.randomUUID();
  const coverUrl = await uploadArtwork(
    supabase,
    launch.cover,
    `${launch.creatorId}/${dropId}/cover.${extensionOf(launch.cover)}`,
    "Artwork"
  );
  const bannerUrl = launch.banner
    ? await uploadArtwork(
        supabase,
        launch.banner,
        `${launch.creatorId}/${dropId}/banner.${extensionOf(launch.banner)}`,
        "Banner"
      )
    : null;

  const { data, error } = await supabase
    .from("collections")
    .insert({
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

  return data.id;
}

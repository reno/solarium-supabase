/**
 * The drop manifest format — the part both the Next app and the Deno edge functions read.
 *
 * Authoring it (parsing a creator's CSV/JSON, validating, ranking) lives in
 * `lib/launchpad/manifest.ts`, which re-exports everything here. This file holds only what the
 * `reveal` function also needs, and so must stay free of any import.
 */

export type ManifestTrait = { trait: string; value: string };

export type ManifestItem = {
  index: number; // 1-based; matches the `{index}.json` written at deploy time
  image: string; // public URL of this item's own artwork
  imageType: string;
  traits: ManifestTrait[];
};

export type DropManifest = {
  version: 1;
  supply: number;
  items: ManifestItem[];
};

export const MANIFEST_VERSION = 1;
export const MANIFEST_FILE = "manifest.json";
export const MEDIA_BUCKET = "nft-media";

export const MAX_DROP_SUPPLY = 250;

// A layer an item didn't roll is still a value it has, and recompute_collection_rarity scores
// items by summing 1/frequency over their traits — so an item that simply omits "Halo" scores
// lower than one with a common halo, which reads as "less rare" for no reason. Writing the
// absence explicitly keeps every item's trait count equal and the scores comparable.
export const ABSENT_TRAIT_VALUE = "None";

// The folder *is* the collection id, so the wizard's uploads and the deploy step's metadata
// writes land in the same place without anything having to record where that place was.
export function dropFolder(creatorId: string, collectionId: string): string {
  return `${creatorId}/${collectionId}`;
}

export function manifestPath(folder: string): string {
  return `${folder}/${MANIFEST_FILE}`;
}

// Item images sit in their own subfolder: only `{n}.json` may live directly under the folder,
// because the candy machine's prefixUri covers everything after it and uriSettings pins the
// remainder to a fixed length.
export function itemImagePath(folder: string, index: number, extension: string): string {
  return `${folder}/items/${index}.${extension}`;
}

// Read back at deploy and at reveal. Deliberately strict: a half-readable manifest would point
// items at the wrong art, which no later step can undo.
export function parseManifest(value: unknown): DropManifest {
  const manifest = value as Partial<DropManifest> | null;
  if (!manifest || typeof manifest !== "object") {
    throw new Error("This drop's item manifest is not an object.");
  }
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(
      `This drop's item manifest is version ${String(manifest.version)}, and this app writes version ${MANIFEST_VERSION}.`
    );
  }
  if (!Array.isArray(manifest.items) || manifest.items.length === 0) {
    throw new Error("This drop's item manifest has no items.");
  }
  if (manifest.supply !== manifest.items.length) {
    throw new Error(
      `This drop's item manifest claims ${String(manifest.supply)} items but lists ${manifest.items.length}.`
    );
  }
  const count = manifest.items.length;
  const items = manifest.items.map((item, position) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Item ${position + 1} in the manifest is not an object.`);
    }
    if (!Number.isInteger(item.index) || item.index < 1 || item.index > count) {
      throw new Error(`Item ${position + 1} in the manifest has an out-of-range number.`);
    }
    if (typeof item.image !== "string" || item.image === "") {
      throw new Error(`Item ${item.index} in the manifest has no artwork URL.`);
    }
    return {
      index: item.index,
      image: item.image,
      imageType: typeof item.imageType === "string" && item.imageType ? item.imageType : "image/png",
      traits: Array.isArray(item.traits)
        ? item.traits
            .filter((trait): trait is ManifestTrait => Boolean(trait) && typeof trait.trait === "string")
            .map(({ trait, value }) => ({ trait, value: String(value ?? "") }))
        : [],
    };
  });
  const numbers = new Set(items.map(({ index }) => index));
  if (numbers.size !== items.length) {
    throw new Error("This drop's item manifest numbers an item twice.");
  }
  return { version: MANIFEST_VERSION, supply: items.length, items: items.sort((a, b) => a.index - b.index) };
}

export function itemAttributes(item: ManifestItem): { trait_type: string; value: string }[] {
  return item.traits.map(({ trait, value }) => ({ trait_type: trait, value }));
}

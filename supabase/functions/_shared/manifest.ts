export type ManifestTrait = { trait: string; value: string };

export type ManifestItem = {
  index: number;
  image: string;
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

export const MAX_TRAITS_PER_ITEM = 64;
export const MAX_TRAIT_FIELD = 128;

export const ABSENT_TRAIT_VALUE = "None";

export function dropFolder(creatorId: string, collectionId: string): string {
  return `${creatorId}/${collectionId}`;
}

export function manifestPath(folder: string): string {
  return `${folder}/${MANIFEST_FILE}`;
}

export function itemImagePath(folder: string, index: number, extension: string): string {
  return `${folder}/items/${index}.${extension}`;
}

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
  if (manifest.items.length > MAX_DROP_SUPPLY) {
    throw new Error(
      `This drop's item manifest lists ${manifest.items.length} items; the maximum is ${MAX_DROP_SUPPLY}.`
    );
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
            .slice(0, MAX_TRAITS_PER_ITEM)
            .map(({ trait, value }) => ({
              trait: trait.slice(0, MAX_TRAIT_FIELD),
              value: String(value ?? "").slice(0, MAX_TRAIT_FIELD),
            }))
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

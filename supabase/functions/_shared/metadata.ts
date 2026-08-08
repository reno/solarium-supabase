/**
 * The Metaplex off-chain metadata shape, written to Supabase Storage and pointed at by the
 * on-chain URI. Shared because the browser writes it at deploy time and the `reveal` function
 * rewrites it afterwards — the two must produce byte-identical JSON for the same item, or a
 * reveal would change more than the artwork. Must stay free of any import.
 */

export type MetadataAttribute = { trait_type: string; value: string };

export function buildNftMetadata({
  name,
  description,
  imageUrl,
  imageType,
  attributes,
}: {
  name: string;
  description: string | null;
  imageUrl: string;
  imageType: string;
  // Read back by the candy-mint edge function into `nfts.traits`, which is what
  // recompute_collection_rarity ranks. Omitted entirely when empty, so a drop without traits
  // gets a null rarity rank rather than one derived from nothing — and so an unrevealed item
  // publishes no attributes at all.
  attributes?: MetadataAttribute[];
}) {
  return {
    name,
    description: description ?? "",
    image: imageUrl,
    ...(attributes && attributes.length > 0 ? { attributes } : {}),
    properties: {
      files: [{ uri: imageUrl, type: imageType }],
      category: "image",
    },
  };
}

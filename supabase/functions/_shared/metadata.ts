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

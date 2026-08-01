export function editionName(
  baseName: string,
  edition: number,
  total: number
): string {
  return total > 1 ? `${baseName} #${edition}/${total}` : baseName;
}

// Metaplex JSON metadata standard (the subset that matters for images).
export function buildNftMetadata({
  name,
  description,
  imageUrl,
  imageType,
}: {
  name: string;
  description: string | null;
  imageUrl: string;
  imageType: string;
}) {
  return {
    name,
    description: description ?? "",
    image: imageUrl,
    properties: {
      files: [{ uri: imageUrl, type: imageType }],
      category: "image",
    },
  };
}

// A generative collection is a supply of unique items. Multi-item drops number each item
// ("Name #3"); a standalone 1/1 keeps its base name. There is no "of N" — items aren't editions.
export function itemName(
  baseName: string,
  number: number,
  supply: number
): string {
  return supply > 1 ? `${baseName} #${number}` : baseName;
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

export function itemName(
  baseName: string,
  number: number,
  supply: number
): string {
  return supply > 1 ? `${baseName} #${number}` : baseName;
}

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

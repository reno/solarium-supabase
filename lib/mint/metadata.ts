export { buildNftMetadata, type MetadataAttribute } from "@/supabase/functions/_shared/metadata";

export function itemName(
  baseName: string,
  number: number,
  supply: number
): string {
  return supply > 1 ? `${baseName} #${number}` : baseName;
}

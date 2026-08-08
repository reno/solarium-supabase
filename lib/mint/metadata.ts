// The metadata shape itself lives in supabase/functions/_shared so the `reveal` edge function
// can build the identical JSON when it rewrites an item after a delayed reveal.
export { buildNftMetadata, type MetadataAttribute } from "@/supabase/functions/_shared/metadata";

export function itemName(
  baseName: string,
  number: number,
  supply: number
): string {
  return supply > 1 ? `${baseName} #${number}` : baseName;
}

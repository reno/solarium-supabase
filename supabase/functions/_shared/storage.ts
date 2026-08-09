/**
 * Recognising — and safely fetching — metadata that this marketplace hosts.
 *
 * Deno-only: this reads `Deno.env`, so unlike the other files in `_shared` it is not imported by
 * the Next app. It is still import-free, for the same reason the rest of this directory is.
 *
 * Two distinct jobs, which were conflated before and produced a false positive that blocked a
 * paid mint from being recorded:
 *
 *   * **Recognising** whether a URL is ours. An asset's `uri` is on-chain data, written by the
 *     browser using NEXT_PUBLIC_SUPABASE_URL. The edge function's own SUPABASE_URL is a
 *     *different string* in local development — `http://kong:8000` inside the container versus
 *     `http://127.0.0.1:54321` in the browser — so comparing against SUPABASE_URL alone rejects
 *     perfectly good items. STORAGE_PUBLIC_URL takes a comma-separated list of additional
 *     origins for exactly this.
 *
 *   * **Fetching** it. Once a URL is recognised, the request goes out over SUPABASE_URL rather
 *     than the origin on chain: the path is the same object either way, and the browser-facing
 *     origin is frequently not reachable from inside the function (127.0.0.1 in a container is
 *     the container). In production the two are identical and this is a no-op.
 */

const PUBLIC_PATH = "/storage/v1/object/public/";

function baseUrls(): string[] {
  const configured = Deno.env.get("STORAGE_PUBLIC_URL") ?? "";
  const bases = [
    ...configured.split(",").map((value) => value.trim()),
    Deno.env.get("SUPABASE_URL") ?? "",
  ].filter(Boolean);
  if (bases.length === 0) throw new Error("SUPABASE_URL is not configured");
  return bases.map((base) => base.replace(/\/+$/, ""));
}

/** Every origin+path prefix that counts as "hosted by this marketplace". */
export function storagePrefixes(): string[] {
  return [...new Set(baseUrls().map((base) => `${base}${PUBLIC_PATH}`))];
}

export function isMarketplaceStorageUrl(url: unknown): url is string {
  return typeof url === "string" && storagePrefixes().some((prefix) => url.startsWith(prefix));
}

/**
 * The same object, addressed the way this function can actually reach it.
 * Only ever called on a URL that `isMarketplaceStorageUrl` has already accepted, so the path is
 * known to be a public storage path and cannot be pointed somewhere else.
 */
export function internalStorageUrl(url: string): string {
  const internal = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!internal) return url;
  try {
    const parsed = new URL(url);
    return `${internal}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

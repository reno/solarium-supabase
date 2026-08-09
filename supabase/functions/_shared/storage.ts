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

export function storagePrefixes(): string[] {
  return [...new Set(baseUrls().map((base) => `${base}${PUBLIC_PATH}`))];
}

export function isMarketplaceStorageUrl(url: unknown): url is string {
  return typeof url === "string" && storagePrefixes().some((prefix) => url.startsWith(prefix));
}

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

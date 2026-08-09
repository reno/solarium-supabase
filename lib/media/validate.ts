export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export const MAX_ITEM_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);

export function safeExtension(filename: string, contentType?: string): string {
  const raw = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (ALLOWED_EXTENSIONS.has(raw)) return raw;
  return EXTENSION_BY_TYPE[contentType ?? ""] ?? "png";
}

function bytesLookLike(header: Uint8Array): string | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => header[i] === b);
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (startsWith(0x52, 0x49, 0x46, 0x46) && header[8] === 0x57 && header[9] === 0x45) return "image/webp";
  if (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) {
    const brand = String.fromCharCode(header[8], header[9], header[10], header[11]);
    if (brand === "avif" || brand === "avis" || brand === "mif1") return "image/avif";
  }
  return null;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(0)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

export async function assertUploadableImage(
  file: File,
  label: string,
  maxBytes: number = MAX_ITEM_IMAGE_BYTES
): Promise<void> {
  if (file.size === 0) throw new Error(`${label} is empty.`);
  if (file.size > maxBytes) {
    throw new Error(`${label} is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)}.`);
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    throw new Error(
      `${label} is ${file.type || "an unknown type"}. Use a PNG, JPEG, WebP, GIF or AVIF image.`
    );
  }
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const actual = bytesLookLike(header);
  if (!actual) {
    throw new Error(`${label} does not look like an image file.`);
  }
  if (actual !== file.type) {
    throw new Error(`${label} is labelled ${file.type} but its contents are ${actual}.`);
  }
}

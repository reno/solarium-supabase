/**
 * Image upload validation.
 *
 * The storage buckets carry `allowed_mime_types` and a `file_size_limit` (see
 * 20260809000400_storage_hardening.sql), which is the enforcement that actually matters — this
 * module exists so a rejection is a sentence the user can act on rather than an opaque storage
 * error, and so the *content* is checked, not just the label.
 *
 * The distinction matters for SVG. Storage validates the declared content type, so a file
 * labelled `image/png` is accepted and then served back as `image/png` no matter what is inside
 * it — which is what makes a mislabelled SVG harmless. Sniffing the magic bytes here closes the
 * remaining gap: the file is rejected before upload rather than stored as something it is not.
 */

export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

// Mirrors the bucket limits. Kept in step with the migration by hand — storage rejects anything
// over these anyway, so drift shows up as a worse error message, not a hole.
export const MAX_ITEM_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/**
 * File extensions we are willing to put in a storage key.
 *
 * `extensionOf` used to return everything after the last dot with no character filter, and
 * `File.name` is arbitrary — a scripted caller could name a file `x.png/../../elsewhere.png` and
 * have the "extension" carry path separators into the object key. An allowlist removes the whole
 * class rather than trying to strip the dangerous parts.
 */
export const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);

export function safeExtension(filename: string, contentType?: string): string {
  const raw = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (ALLOWED_EXTENSIONS.has(raw)) return raw;
  // Fall back to what the content type says, then to png — never to whatever was in the name.
  return EXTENSION_BY_TYPE[contentType ?? ""] ?? "png";
}

function bytesLookLike(header: Uint8Array): string | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => header[i] === b);
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  // RIFF....WEBP
  if (startsWith(0x52, 0x49, 0x46, 0x46) && header[8] === 0x57 && header[9] === 0x45) return "image/webp";
  // ....ftypavif — the brand sits at offset 8.
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

/**
 * Throws with a message meant for the user if the file is not an image we accept.
 * `label` names the file in that message ("Cover image", "Item 4", …).
 */
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
  // jpg/jpeg and the avif family are the only places the declared type and the sniffed type can
  // legitimately disagree in a way we care about, and both resolve to the same value above.
  if (actual !== file.type) {
    throw new Error(`${label} is labelled ${file.type} but its contents are ${actual}.`);
  }
}

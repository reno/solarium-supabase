export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function readCompactU16(bytes: Uint8Array, offset: number): { value: number; size: number } {
  let value = 0;
  let size = 0;
  for (;;) {
    if (offset + size >= bytes.length) {
      throw new Error("Malformed transaction: truncated length prefix.");
    }
    const byte = bytes[offset + size];
    value |= (byte & 0x7f) << (size * 7);
    size += 1;
    if ((byte & 0x80) === 0) break;
    if (size > 3) throw new Error("Malformed transaction: oversized length prefix.");
  }
  return { value, size };
}

export function messageBytesOf(serializedTransaction: Uint8Array): Uint8Array {
  const { value: signatureCount, size } = readCompactU16(serializedTransaction, 0);
  const start = size + signatureCount * 64;
  if (start > serializedTransaction.length) {
    throw new Error("Malformed transaction: signatures overrun the buffer.");
  }
  return serializedTransaction.slice(start);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBase58(value: unknown): value is string {
  return typeof value === "string" && BASE58_RE.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

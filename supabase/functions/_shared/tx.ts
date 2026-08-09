// Transaction wire-format helpers, shared by the settlement functions.
//
// Import-free by the same rule as the other files in this directory: Deno resolves them by
// relative path with a .ts extension and the Next app by "@/supabase/functions/_shared/…"
// without one, so anything either side might import must not pull in a package. Everything
// here is built on globals (atob, crypto.subtle) and plain arithmetic.

/** Decode a standard base64 string to bytes. */
export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Read a compact-u16 ("short vec") length prefix, the format Solana uses for the array counts
 * in a serialized transaction. Seven bits per byte, high bit set means another byte follows.
 */
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
    // Three bytes is the maximum a u16 can occupy in this encoding.
    if (size > 3) throw new Error("Malformed transaction: oversized length prefix.");
  }
  return { value, size };
}

/**
 * Strip the signature array off a serialized transaction, leaving the message.
 *
 * The wire layout is: compact-u16 signature count, then 64 bytes per signature, then the
 * message. The message is what gets signed, so it is stable across who has signed it — which
 * is exactly why it is the right thing to bind a settlement to. Two transactions with the same
 * message are the same instructions, accounts, ordering and lamport amounts, whether or not
 * the buyer had added their signature yet when we hashed it.
 */
export function messageBytesOf(serializedTransaction: Uint8Array): Uint8Array {
  const { value: signatureCount, size } = readCompactU16(serializedTransaction, 0);
  const start = size + signatureCount * 64;
  if (start > serializedTransaction.length) {
    throw new Error("Malformed transaction: signatures overrun the buffer.");
  }
  return serializedTransaction.slice(start);
}

/** Lowercase hex sha256, used as the settlement intent key. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A plausible base58 transaction signature or address. Length-bounded so a huge string cannot
 *  reach the RPC or the database. */
export function isBase58(value: unknown): value is string {
  return typeof value === "string" && BASE58_RE.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

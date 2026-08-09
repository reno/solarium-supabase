/**
 * Turning a backend failure into something safe to render.
 *
 * PostgREST error text names columns, constraints and policies ("new row violates row-level
 * security policy for table \"listings\""), and RPC errors name the provider endpoint — which in
 * this project carries an API key. None of that helps the person reading it, and all of it helps
 * someone mapping the schema.
 *
 * Errors this app raises itself are already written for a person, so they pass through. What gets
 * replaced is anything that looks like it came from Postgres, PostgREST or an RPC provider.
 */

type MaybePostgrestError = {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
};

// Codes worth translating rather than flattening, because the user can act on them.
const FRIENDLY_BY_CODE: Record<string, string> = {
  "23505": "That already exists.",
  "23503": "Something this refers to no longer exists. Reload and try again.",
  "23514": "Those values aren't allowed.",
  "42501": "You don't have permission to do that.",
  "P0001": "That isn't allowed right now.",
};

// Shapes that mean "this came from the database or the network layer, not from us".
const INTERNAL_MARKERS = [
  /row-level security/i,
  /violates .*constraint/i,
  /permission denied/i,
  /relation ".*" does not exist/i,
  /column ".*"/i,
  /duplicate key value/i,
  /https?:\/\//, // any URL: RPC endpoints here carry an API key
  /JWT|jwt/,
  /PGRST\d+/,
];

const GENERIC = "Something went wrong. Please try again.";

export function friendlyError(error: unknown, fallback: string = GENERIC): string {
  if (!error) return fallback;

  const candidate = error as MaybePostgrestError;
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  if (code && FRIENDLY_BY_CODE[code]) return FRIENDLY_BY_CODE[code];

  const message =
    typeof candidate.message === "string"
      ? candidate.message
      : error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "";

  if (!message) return fallback;
  if (INTERNAL_MARKERS.some((pattern) => pattern.test(message))) return fallback;
  // A `code` at all is the tell that this is a PostgREST envelope rather than one of ours.
  if (code) return fallback;
  return message;
}

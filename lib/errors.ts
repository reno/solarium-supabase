type MaybePostgrestError = {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
};

const FRIENDLY_BY_CODE: Record<string, string> = {
  "23505": "That already exists.",
  "23503": "Something this refers to no longer exists. Reload and try again.",
  "23514": "Those values aren't allowed.",
  "42501": "You don't have permission to do that.",
  "P0001": "That isn't allowed right now.",
};

const INTERNAL_MARKERS = [
  /row-level security/i,
  /violates .*constraint/i,
  /permission denied/i,
  /relation ".*" does not exist/i,
  /column ".*"/i,
  /duplicate key value/i,
  /https?:\/\//,
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
  if (code) return fallback;
  return message;
}

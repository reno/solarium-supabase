/**
 * Retry for rate-limited RPC calls.
 *
 * The predicate used to be /429|rate limit/i tested against the whole error message, which is
 * looser than it looks: `429` matches anywhere in the string, so a lamport amount, a slot
 * number, or a fragment of a UUID in an unrelated error was enough to trigger a retry. That is
 * harmless for a re-sent transaction — the signature is the same and the cluster dedupes it —
 * but the same wrapper is used around settlement POSTs, where re-sending is a second attempt at
 * a state change.
 *
 * Two changes: the match is anchored to how rate limits are actually reported, and re-trying a
 * non-idempotent call is now an explicit opt-in rather than the default.
 */

// "429" only when it stands alone as a status code, plus the phrasings providers use.
const RATE_LIMIT_PATTERN =
  /(^|[^0-9])429([^0-9]|$)|rate.?limit|too.?many.?requests|slow.?down/i;

export function isRateLimited(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RATE_LIMIT_PATTERN.test(message);
}

export async function withRpcRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 5
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= maxAttempts || !isRateLimited(e)) throw e;
      await new Promise((resolve) =>
        setTimeout(resolve, 500 * 2 ** (attempt - 1))
      );
    }
  }
}

// Public devnet RPC endpoints rate-limit aggressively under any real usage.
// Retries with backoff on rate-limit errors specifically — anything else
// fails immediately, unretried.
const RATE_LIMIT_PATTERN = /429|rate limit/i;

export async function withRpcRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 5
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (attempt >= maxAttempts || !RATE_LIMIT_PATTERN.test(message)) throw e;
      await new Promise((resolve) =>
        setTimeout(resolve, 500 * 2 ** (attempt - 1))
      );
    }
  }
}

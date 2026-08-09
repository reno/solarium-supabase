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

// A single global pacer in front of every RPC request the browser makes.
//
// Free-tier endpoints rate-limit per second, and this client bursts: a candy machine deploy
// interleaves a handful of sends with two polling loops, and one of those loops lives inside
// web3.js's `confirmTransaction`, where `withRpcRetry` cannot reach it — a 429 there is caught
// and discarded, so the loop keeps hammering. Gating at the transport is the only layer that
// covers it, and spacing requests out is cheaper than retrying the ones that get refused.

const DEFAULT_MAX_REQUESTS_PER_SECOND = 8;
const MAX_ATTEMPTS = 5;
const FALLBACK_BACKOFF_MS = 1000;
// Endpoints that count a burst against a 1s window punish perfectly even spacing, because every
// client retrying in lockstep lands in the same window. A few ms of noise decorrelates them.
const JITTER_MS = 25;

function maxRequestsPerSecond(): number {
  const parsed = Number(process.env.NEXT_PUBLIC_SOLANA_RPC_MAX_RPS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_REQUESTS_PER_SECOND;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The next instant a request is allowed to start. Advanced synchronously as slots are handed
// out, so concurrent callers each get their own slot without a lock — the rate is capped, the
// concurrency is not.
let nextStart = 0;

async function acquireSlot(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextStart);
  nextStart = start + 1000 / maxRequestsPerSecond() + Math.random() * JITTER_MS;
  const wait = start - now;
  if (wait > 0) await delay(wait);
}

// A 429 is about the endpoint, not the request that happened to draw it, so back every caller
// off together rather than letting the other in-flight requests keep going.
function backOffEveryone(ms: number): void {
  nextStart = Math.max(nextStart, Date.now() + ms);
}

// `Retry-After` is either a count of seconds or an HTTP date.
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export async function throttledFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    await acquireSlot();
    const response = await fetch(input, init);
    if (response.status !== 429 || attempt >= MAX_ATTEMPTS) return response;
    backOffEveryone(retryAfterMs(response) ?? FALLBACK_BACKOFF_MS * 2 ** (attempt - 1));
    // Release the connection before asking for the same thing again.
    await response.arrayBuffer().catch(() => {});
  }
}

// For clients that expose a transport rather than a fetch hook. No 429 retry here: the callers
// wrap their own (`withRpcRetry`), and this path carries far less traffic than umi's.
export async function throttled<T>(run: () => Promise<T>): Promise<T> {
  await acquireSlot();
  return run();
}

// Test seam — the pacer's cursor is module state that would otherwise leak between cases.
export function resetThrottleForTests(): void {
  nextStart = 0;
}

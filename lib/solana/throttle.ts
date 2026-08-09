const DEFAULT_MAX_REQUESTS_PER_SECOND = 8;
const MAX_ATTEMPTS = 5;
const FALLBACK_BACKOFF_MS = 1000;
const JITTER_MS = 25;

function maxRequestsPerSecond(): number {
  const parsed = Number(process.env.NEXT_PUBLIC_SOLANA_RPC_MAX_RPS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_REQUESTS_PER_SECOND;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let nextStart = 0;

async function acquireSlot(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextStart);
  nextStart = start + 1000 / maxRequestsPerSecond() + Math.random() * JITTER_MS;
  const wait = start - now;
  if (wait > 0) await delay(wait);
}

function backOffEveryone(ms: number): void {
  nextStart = Math.max(nextStart, Date.now() + ms);
}

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
    await response.arrayBuffer().catch(() => {});
  }
}

export async function throttled<T>(run: () => Promise<T>): Promise<T> {
  await acquireSlot();
  return run();
}

export function resetThrottleForTests(): void {
  nextStart = 0;
}

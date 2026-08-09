/**
 * The pacer only shows up as an absence — requests that never got refused — so its behaviour is
 * pinned here rather than rediscovered the next time a deploy trips a free-tier limit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetThrottleForTests, throttled, throttledFetch } from "./throttle";

const ok = () => new Response("{}", { status: 200 });
const tooManyRequests = (retryAfter?: string) =>
  new Response("rate limited", {
    status: 429,
    headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
  });

beforeEach(() => {
  resetThrottleForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("throttledFetch", () => {
  it("spaces concurrent requests out instead of firing them at once", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_RPC_MAX_RPS", "10");
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);

    // The shape of the problem: several polls kicked off in the same tick.
    const all = Promise.all(
      Array.from({ length: 5 }, () => throttledFetch("https://rpc.test"))
    );

    // First slot is immediate; the rest are still waiting on their turn.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // At 10/s each subsequent slot is ~100ms out (plus jitter), so 250ms buys ~2 more.
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls.length).toBeLessThan(5);

    await vi.advanceTimersByTimeAsync(1000);
    await all;
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("honours Retry-After on a 429 and returns the retried response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tooManyRequests("2"))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);

    const call = throttledFetch("https://rpc.test");

    // Still inside the window the endpoint asked us to wait out.
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    await expect(call.then((r) => r.status)).resolves.toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("backs off every caller, not just the one that drew the 429", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_RPC_MAX_RPS", "100");
    const fetchMock = vi.fn().mockResolvedValue(tooManyRequests("5"));
    vi.stubGlobal("fetch", fetchMock);

    const first = throttledFetch("https://rpc.test").catch(() => null);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A second caller queued after the refusal must wait out the same window, even though at
    // 100/s its own slot would otherwise be 10ms away.
    const second = throttledFetch("https://rpc.test").catch(() => null);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all([first, second]);
  });

  it("gives up after the attempt cap and hands back the 429", async () => {
    const fetchMock = vi.fn().mockResolvedValue(tooManyRequests("1"));
    vi.stubGlobal("fetch", fetchMock);

    const call = throttledFetch("https://rpc.test");
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(call.then((r) => r.status)).resolves.toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe("throttled", () => {
  it("draws from the same budget as throttledFetch", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_RPC_MAX_RPS", "4");
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetchMock);
    const run = vi.fn().mockResolvedValue("done");

    void throttledFetch("https://rpc.test");
    const gated = throttled(run);

    // The fetch took the first slot, so the transport call waits ~250ms for the next one.
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    await expect(gated).resolves.toBe("done");
  });
});

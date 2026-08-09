import { describe, expect, it } from "vitest";

import { isRateLimited, withRpcRetry } from "@/lib/solana/retry";

describe("isRateLimited", () => {
  it("matches how providers actually report a rate limit", () => {
    expect(isRateLimited(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRateLimited(new Error("Server responded with 429"))).toBe(true);
    expect(isRateLimited(new Error("rate limit exceeded"))).toBe(true);
    expect(isRateLimited(new Error("Rate-limited, please retry"))).toBe(true);
    expect(isRateLimited(new Error("too many requests"))).toBe(true);
  });

  // The old predicate was /429|rate limit/i against the whole message, so any error that merely
  // contained those three digits retried. That is harmless when re-sending an already-signed
  // transaction, but the same wrapper sat around the settlement POSTs, where a retry is another
  // attempt at a state change.
  it("does not match a 429 buried inside an unrelated number", () => {
    expect(isRateLimited(new Error("insufficient funds: needed 4290000 lamports"))).toBe(false);
    expect(isRateLimited(new Error("listing 8a1429bd-0000-0000-0000-000000000000 not found"))).toBe(false);
    expect(isRateLimited(new Error("block height 142900 exceeded"))).toBe(false);
    expect(isRateLimited(new Error("Transaction simulation failed"))).toBe(false);
  });

  it("handles non-Error throwables", () => {
    expect(isRateLimited("429 Too Many Requests")).toBe(true);
    expect(isRateLimited({ nope: true })).toBe(false);
  });
});

describe("withRpcRetry", () => {
  it("retries a rate-limited call and returns the eventual success", async () => {
    let calls = 0;
    const result = await withRpcRetry(async () => {
      calls += 1;
      if (calls < 2) throw new Error("429 Too Many Requests");
      return "ok";
    }, 3);
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry anything else", async () => {
    let calls = 0;
    await expect(
      withRpcRetry(async () => {
        calls += 1;
        throw new Error("insufficient funds: needed 4290000 lamports");
      }, 3)
    ).rejects.toThrow(/insufficient funds/);
    expect(calls).toBe(1);
  });
});

/**
 * The retry policy is the whole point of this module, and it only shows up in failure — so it is
 * pinned here rather than discovered the next time an RPC blips mid-mint.
 *
 * (A test file next to an import-free module is fine: nothing imports it, so it never reaches the
 * Deno bundle for either function.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { rpcCall } from "./rpc";

const ok = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const rpcError = (message: string) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("rpcCall", () => {
  // The exact failure that stranded a mint: the transaction was already on chain, and the only
  // thing that went wrong was a name lookup inside the function.
  it("retries a DNS failure and succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("error sending request: name resolution failed"))
      .mockResolvedValueOnce(ok({ slot: 7 }));
    vi.stubGlobal("fetch", fetchMock);

    const call = rpcCall("https://rpc.test", "getTransaction", []);
    await vi.runAllTimersAsync();

    await expect(call).resolves.toEqual({ slot: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still retries a rate limit", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(ok({ slot: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const call = rpcCall("https://rpc.test", "getTransaction", []);
    await vi.runAllTimersAsync();

    await expect(call).resolves.toEqual({ slot: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a gateway that answers with something that isn't JSON", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>502</html>", { status: 502 }))
      .mockResolvedValueOnce(ok({ slot: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    const call = rpcCall("https://rpc.test", "getTransaction", []);
    await vi.runAllTimersAsync();

    await expect(call).resolves.toEqual({ slot: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // The node answered and said no. Retrying would just ask the same question four more times,
  // and worse, delay a real error the caller needs to see.
  it("does not retry an error the node actually returned", async () => {
    const fetchMock = vi.fn().mockResolvedValue(rpcError("Invalid param: WrongSize"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(rpcCall("https://rpc.test", "getTransaction", [])).rejects.toThrow(
      "getTransaction: Invalid param: WrongSize"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after five attempts and says it could not reach the RPC", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("name resolution failed"));
    vi.stubGlobal("fetch", fetchMock);

    const call = rpcCall("https://rpc.test", "getTransaction", []);
    const assertion = expect(call).rejects.toThrow(/could not reach the Solana RPC/);
    await vi.runAllTimersAsync();

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("returns a null result rather than treating it as a failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(null));
    vi.stubGlobal("fetch", fetchMock);

    // getTransaction answers null for a signature the node hasn't seen; candy-mint turns that
    // into "not confirmed yet", which is a different thing from a broken request.
    await expect(rpcCall("https://rpc.test", "getTransaction", [])).resolves.toBeNull();
  });
});

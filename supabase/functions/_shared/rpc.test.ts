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

    await expect(rpcCall("https://rpc.test", "getTransaction", [])).resolves.toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { decodeBase64, isBase58, isUuid, messageBytesOf, sha256Hex } from "./tx";

function wireTx(signatureCount: number, message: number[]): Uint8Array {
  const prefix: number[] = [];
  let n = signatureCount;
  for (;;) {
    const byte = n & 0x7f;
    n >>= 7;
    if (n === 0) {
      prefix.push(byte);
      break;
    }
    prefix.push(byte | 0x80);
  }
  return new Uint8Array([...prefix, ...new Array(signatureCount * 64).fill(0xab), ...message]);
}

const MESSAGE = [1, 2, 3, 4, 5];

describe("messageBytesOf", () => {
  it("strips a single signature", () => {
    expect(Array.from(messageBytesOf(wireTx(1, MESSAGE)))).toEqual(MESSAGE);
  });

  it("strips both signatures of a co-signed settlement", () => {
    expect(Array.from(messageBytesOf(wireTx(2, MESSAGE)))).toEqual(MESSAGE);
  });

  it("handles a multi-byte compact-u16 count", () => {
    expect(Array.from(messageBytesOf(wireTx(130, MESSAGE)))).toEqual(MESSAGE);
  });

  it("yields the same message whether or not the buyer has signed yet", () => {
    const unsigned = messageBytesOf(wireTx(1, MESSAGE));
    const signed = messageBytesOf(wireTx(2, MESSAGE));
    expect(Array.from(unsigned)).toEqual(Array.from(signed));
  });

  it("refuses a buffer whose signatures overrun it", () => {
    expect(() => messageBytesOf(new Uint8Array([4, 0, 0, 0]))).toThrow(/overrun/);
  });

  it("refuses a truncated length prefix", () => {
    expect(() => messageBytesOf(new Uint8Array([0x80]))).toThrow(/truncated/);
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of the empty input", async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("matches the known digest of 'abc'", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("separates messages that differ by one lamport", async () => {
    const a = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]);
    const b = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 2]);
    expect(await sha256Hex(a)).not.toBe(await sha256Hex(b));
  });
});

describe("decodeBase64", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 250, 255, 128]);
    const encoded = btoa(String.fromCharCode(...bytes));
    expect(Array.from(decodeBase64(encoded))).toEqual(Array.from(bytes));
  });
});

describe("input shape guards", () => {
  it("accepts real signatures and addresses", () => {
    expect(isBase58("5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW")).toBe(true);
    expect(isBase58("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d")).toBe(true);
  });

  it("rejects the characters base58 leaves out, and anything unbounded", () => {
    expect(isBase58("0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl")).toBe(false);
    expect(isBase58("short")).toBe(false);
    expect(isBase58("a".repeat(500))).toBe(false);
    expect(isBase58("../../etc/passwd")).toBe(false);
    expect(isBase58(null)).toBe(false);
  });

  it("accepts uuids and nothing else", () => {
    expect(isUuid("8a1429bd-0000-4000-8000-000000000000")).toBe(true);
    expect(isUuid("8a1429bd0000400080000000000000000")).toBe(false);
    expect(isUuid("'; drop table listings; --")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

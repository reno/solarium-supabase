import { describe, expect, it } from "vitest";
import { lamportsToSol, solToLamports, LAMPORTS_PER_SOL } from "./lamports";

describe("lamportsToSol", () => {
  it("formats whole SOL", () => {
    expect(lamportsToSol(LAMPORTS_PER_SOL)).toBe("1");
    expect(lamportsToSol(0n)).toBe("0");
  });

  it("formats fractional SOL without trailing zeros", () => {
    expect(lamportsToSol(1_500_000_000n)).toBe("1.5");
    expect(lamportsToSol(1n)).toBe("0.000000001");
  });
});

describe("solToLamports", () => {
  it("parses whole and fractional amounts", () => {
    expect(solToLamports("1")).toBe(LAMPORTS_PER_SOL);
    expect(solToLamports("0.5")).toBe(500_000_000n);
    expect(solToLamports("0.000000001")).toBe(1n);
  });

  it("round-trips", () => {
    for (const v of [0n, 1n, 999_999_999n, 12_345_678_901n]) {
      expect(solToLamports(lamportsToSol(v))).toBe(v);
    }
  });

  it("rejects garbage and sub-lamport precision", () => {
    expect(() => solToLamports("abc")).toThrow();
    expect(() => solToLamports("1.0000000001")).toThrow();
    expect(() => solToLamports("1e9")).toThrow();
  });
});

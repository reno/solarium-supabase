import { describe, expect, it } from "vitest";
import { deltaBps, deltaLabel } from "./delta";

describe("deltaBps", () => {
  it("measures the current window against the previous one", () => {
    expect(deltaBps(150n, 100n)).toBe(5000);
    expect(deltaBps(75n, 100n)).toBe(-2500);
    expect(deltaBps(100n, 100n)).toBe(0);
  });

  it("treats volume with no prior baseline as +100%", () => {
    expect(deltaBps(500n, 0n)).toBe(10000);
  });

  it("returns null when neither window traded", () => {
    expect(deltaBps(0n, 0n)).toBeNull();
  });

  it("stays exact on lamport-scale values", () => {
    expect(deltaBps(3_000_000_000n, 2_000_000_000n)).toBe(5000);
  });
});

describe("deltaLabel", () => {
  it("signs with U+2212 for negatives", () => {
    expect(deltaLabel(1240)).toBe("+12.4%");
    expect(deltaLabel(-310)).toBe("−3.1%");
    expect(deltaLabel(0)).toBe("+0.0%");
  });

  it("renders an em dash when there is nothing to compare", () => {
    expect(deltaLabel(null)).toBe("—");
  });
});

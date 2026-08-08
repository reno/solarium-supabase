import { describe, expect, it } from "vitest";

import {
  configLineFor,
  guardGroupsFor,
  guardsForPhase,
  itemNumberFromName,
  mintLimitId,
  nameSettings,
  orderPhases,
  phaseGroupLabel,
  phaseIndexFromLabel,
  uriSettings,
  type PhaseInput,
} from "@/lib/launchpad/candy-guards";
import { feeOf } from "@/supabase/functions/_shared/fee";

const CREATOR = "H5KwtC7LAnQCeEQ3Ke48uuiVj2qcgdbheSFcscHx6MDF";
const TREASURY = "2H4J2TPtPpoimHcKf5YYhHHzHbBTVTHJ4m2oUJ7XFq1c";

function phase(overrides: Partial<PhaseInput> = {}): PhaseInput {
  return {
    id: "phase-1",
    name: "Public",
    priceLamports: 1_000_000_000n,
    startsAt: "2026-08-01T00:00:00.000Z",
    endsAt: null,
    perWalletLimit: null,
    allowlistOnly: false,
    position: 0,
    ...overrides,
  };
}

const ctx = { creatorWallet: CREATOR, treasuryWallet: TREASURY, merkleRoot: null };

function set<T>(option: unknown): T {
  const wrapped = option as { __option?: string; value?: T } | undefined;
  if (wrapped?.__option !== "Some") throw new Error(`expected a set guard, got ${JSON.stringify(option)}`);
  return wrapped.value as T;
}

describe("group labels", () => {
  it("round-trips a phase index through its 6-byte label", () => {
    for (const index of [0, 1, 9, 42]) {
      expect(phaseIndexFromLabel(phaseGroupLabel(index))).toBe(index);
      expect(phaseGroupLabel(index).length).toBeLessThanOrEqual(6);
    }
  });

  it("gives each phase its own mint-limit counter", () => {
    expect(mintLimitId(0)).toBe(1);
    expect(mintLimitId(1)).not.toBe(mintLimitId(0));
  });

  it("orders phases by position, then start time", () => {
    const ordered = orderPhases([
      phase({ id: "c", position: 1 }),
      phase({ id: "a", position: 0, startsAt: "2026-08-01T00:00:00.000Z" }),
      phase({ id: "b", position: 0, startsAt: "2026-07-01T00:00:00.000Z" }),
    ]);
    expect(ordered.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });
});

describe("config line settings", () => {
  it("keeps prefix + numbered suffix inside the on-chain 32-byte name", () => {
    const { prefixName, nameLength } = nameSettings("A Very Long Collection Name That Overflows", 250);
    expect(prefixName.length + nameLength).toBeLessThanOrEqual(32);
    expect(prefixName.endsWith(" #")).toBe(true);
    expect(nameLength).toBe(3);
  });

  it("sizes the uri suffix for the largest item number", () => {
    expect(uriSettings("https://x.co/d/", 9).uriLength).toBe("9.json".length);
    expect(uriSettings("https://x.co/d/", 100).uriLength).toBe("100.json".length);
    expect(configLineFor(7)).toEqual({ name: "7", uri: "7.json" });
  });

  it("rejects a metadata prefix that can't fit on chain", () => {
    expect(() => uriSettings(`https://x.co/${"d".repeat(200)}/`, 10)).toThrow(/too long/i);
  });

  it("reads an item's number back off the name the chain produced", () => {
    expect(itemNumberFromName("Solar Flare #17")).toBe(17);
    expect(itemNumberFromName("Solar Flare")).toBeNull();
  });
});

describe("phase → guards", () => {
  it("charges the price to the creator and the marketplace fee to the treasury", () => {
    const guards = guardsForPhase(phase(), 0, ctx);
    const payment = set<{ destination: string; lamports: { basisPoints: bigint } }>(guards.solPayment);
    expect(payment.destination).toBe(CREATOR);
    expect(payment.lamports.basisPoints).toBe(1_000_000_000n);
    const fee = set<{ destination: string; lamports: { basisPoints: bigint } }>(guards.solFixedFee);
    expect(fee.destination).toBe(TREASURY);
    expect(fee.lamports.basisPoints).toBe(feeOf(1_000_000_000n));
    // Pinned literal: 1% of 1 SOL. Catches a silent change to FEE_BPS.
    expect(fee.lamports.basisPoints).toBe(10_000_000n);
  });

  it("omits payment and fee guards for a free mint", () => {
    const guards = guardsForPhase(phase({ priceLamports: 0n }), 0, ctx);
    expect(guards.solPayment).toBeUndefined();
    expect(guards.solFixedFee).toBeUndefined();
    expect(set(guards.startDate)).toBeDefined();
  });

  it("only sets endDate, mintLimit and allowList when the phase asks for them", () => {
    const bare = guardsForPhase(phase(), 0, ctx);
    expect(bare.endDate).toBeUndefined();
    expect(bare.mintLimit).toBeUndefined();
    expect(bare.allowList).toBeUndefined();

    const full = guardsForPhase(
      phase({ endsAt: "2026-09-01T00:00:00.000Z", perWalletLimit: 3, allowlistOnly: true }),
      2,
      { ...ctx, merkleRoot: new Uint8Array(32).fill(9) }
    );
    expect(set(full.mintLimit)).toEqual({ id: mintLimitId(2), limit: 3 });
    expect(set(full.endDate)).toBeDefined();
    expect(set<{ merkleRoot: Uint8Array }>(full.allowList).merkleRoot).toEqual(new Uint8Array(32).fill(9));
  });

  it("refuses an allowlist-only phase with nobody on the allowlist", () => {
    expect(() => guardsForPhase(phase({ allowlistOnly: true }), 0, ctx)).toThrow(/allowlist is empty/i);
  });

  it("builds one labelled group per phase, in run order", () => {
    const groups = guardGroupsFor([phase({ id: "b", position: 1 }), phase({ id: "a", position: 0 })], ctx);
    expect(groups.map((g) => g.label)).toEqual(["p0", "p1"]);
  });

  it("skips phases that already ended, so a closed allowlist can't block the deploy", () => {
    const now = Date.parse("2026-08-07T22:44:00.000Z");
    const groups = guardGroupsFor(
      [
        phase({
          id: "allow",
          name: "Allowlist",
          position: 0,
          allowlistOnly: true,
          startsAt: "2026-08-07T22:33:00.000Z",
          endsAt: "2026-08-07T22:35:00.000Z",
        }),
        phase({ id: "public", name: "Public", position: 1, startsAt: "2026-08-07T22:35:00.000Z" }),
      ],
      { ...ctx, merkleRoot: null },
      now
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("p1");
  });

  it("still refuses an allowlist-only phase that has not ended yet", () => {
    const now = Date.parse("2026-08-07T22:34:00.000Z");
    expect(() =>
      guardGroupsFor(
        [phase({ allowlistOnly: true, endsAt: "2026-08-07T22:35:00.000Z" })],
        { ...ctx, merkleRoot: null },
        now
      )
    ).toThrow(/allowlist is empty/i);
  });

  it("refuses a deploy where every phase is already over", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    expect(() =>
      guardGroupsFor([phase({ endsAt: "2026-08-07T22:35:00.000Z" })], ctx, now)
    ).toThrow(/already ended/i);
  });
});

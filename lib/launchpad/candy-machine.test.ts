import { describe, expect, it } from "vitest";

import {
  candyMachineAccountSize,
  deriveConfigLineSettings,
  guardLabel,
  phasesToGuardGroups,
  stripPrefixes,
  type ConfigLineItem,
  type PhaseGuardInput,
} from "./candy-machine";

const CREATOR = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const TREASURY = "GDfnEsia2WLAW5t8yx2X5j2mkfA74i5kwGdDuZHt7XmG";

function phase(over: Partial<PhaseGuardInput> = {}): PhaseGuardInput {
  return {
    id: "phase-1",
    position: 0,
    priceLamports: 1_000_000_000n,
    startsAt: "2026-09-01T00:00:00.000Z",
    endsAt: null,
    perWalletLimit: null,
    allowlistOnly: false,
    ...over,
  };
}

function groupsFor(phases: PhaseGuardInput[], allowlist: string[] = [], feeBps = 200) {
  return phasesToGuardGroups({
    phases,
    creatorWallet: CREATOR,
    treasuryWallet: TREASURY,
    allowlist,
    feeBps,
  });
}

describe("guardLabel", () => {
  it("stays inside the 6-byte on-chain label field", () => {
    for (const position of [0, 1, 9, 42, 9999]) {
      expect(guardLabel(position).length).toBeLessThanOrEqual(6);
    }
  });

  it("is stable and distinct per position", () => {
    expect(guardLabel(0)).toBe("g0");
    expect(guardLabel(1)).toBe("g1");
    expect(guardLabel(0)).not.toBe(guardLabel(1));
  });
});

describe("phasesToGuardGroups", () => {
  it("orders groups by phase position, not input order", () => {
    const groups = groupsFor([
      phase({ id: "b", position: 1 }),
      phase({ id: "a", position: 0 }),
    ]);
    expect(groups.map((g) => g.phaseId)).toEqual(["a", "b"]);
    expect(groups.map((g) => g.label)).toEqual(["g0", "g1"]);
  });

  it("prices the phase to the creator and the fee to the treasury", () => {
    const [group] = groupsFor([phase({ priceLamports: 1_000_000_000n })]);
    expect(group.guards.solPayment).toMatchObject({
      value: {
        lamports: { basisPoints: 1_000_000_000n },
        destination: CREATOR,
      },
    });
    // 2% of 1 SOL, exact in lamports — never floating-point SOL.
    expect(group.guards.solFixedFee).toMatchObject({
      value: { lamports: { basisPoints: 20_000_000n } },
    });
  });

  it("rounds the fee down rather than inventing a lamport", () => {
    const [group] = groupsFor([phase({ priceLamports: 199n })]);
    // 199 * 200 / 10000 = 3.98 → 3.
    expect(group.guards.solFixedFee).toMatchObject({
      value: { lamports: { basisPoints: 3n } },
    });
  });

  it("omits the fee guard on a free phase and when there is no treasury", () => {
    const [free] = groupsFor([phase({ priceLamports: 0n })]);
    expect(free.guards.solFixedFee).toBeUndefined();

    const [noTreasury] = phasesToGuardGroups({
      phases: [phase()],
      creatorWallet: CREATOR,
      treasuryWallet: null,
      allowlist: [],
      feeBps: 200,
    });
    expect(noTreasury.guards.solFixedFee).toBeUndefined();
    // The drop still deploys — only the platform's cut is dropped.
    expect(noTreasury.guards.solPayment).toBeDefined();
  });

  it("always sets a start date and only sets an end date when the phase has one", () => {
    const [open] = groupsFor([phase({ endsAt: null })]);
    expect(open.guards.startDate).toBeDefined();
    expect(open.guards.endDate).toBeUndefined();

    const [closed] = groupsFor([phase({ endsAt: "2026-09-02T00:00:00.000Z" })]);
    expect(closed.guards.endDate).toBeDefined();
  });

  it("gives each phase its own mintLimit counter so limits stack", () => {
    const groups = groupsFor([
      phase({ id: "a", position: 0, perWalletLimit: 2 }),
      phase({ id: "b", position: 1, perWalletLimit: 2 }),
    ]);
    // Distinct ids = distinct on-chain counter PDAs = "2 in allowlist AND 2 more in public",
    // which is what the phase list shows the buyer.
    expect(groups[0].guards.mintLimit).toMatchObject({ value: { id: 0, limit: 2 } });
    expect(groups[1].guards.mintLimit).toMatchObject({ value: { id: 1, limit: 2 } });
  });

  it("omits mintLimit when the phase is unlimited", () => {
    const [group] = groupsFor([phase({ perWalletLimit: null })]);
    expect(group.guards.mintLimit).toBeUndefined();
  });

  it("guards an allowlist phase even when nobody is on the list", () => {
    // An empty root nobody can prove against is the safe reading of "allowlist only, list empty" —
    // silently becoming a public phase would sell the drop out from under the creator.
    const [group] = groupsFor([phase({ allowlistOnly: true })], []);
    expect(group.guards.allowList).toBeDefined();
  });

  it("leaves a public phase without an allowList guard", () => {
    const [group] = groupsFor([phase({ allowlistOnly: false })], [CREATOR]);
    expect(group.guards.allowList).toBeUndefined();
  });

  it("roots the allowlist in the wallets given", () => {
    const [withList] = groupsFor([phase({ allowlistOnly: true })], [CREATOR, TREASURY]);
    const [empty] = groupsFor([phase({ allowlistOnly: true })], []);
    expect(withList.guards.allowList).not.toEqual(empty.guards.allowList);
  });
});

describe("deriveConfigLineSettings", () => {
  const items = (n: number): ConfigLineItem[] =>
    Array.from({ length: n }, (_, i) => ({
      name: `Solarium #${i + 1}`,
      uri: `https://storage.example/meta/${i + 1}.json`,
    }));

  it("extracts the shared prefix so it is stored once, not per line", () => {
    const settings = deriveConfigLineSettings(items(3));
    expect(settings.prefixName).toBe("Solarium #");
    expect(settings.prefixUri).toBe("https://storage.example/meta/");
    expect(settings.nameLength).toBe(1); // "1", "2", "3"
    expect(settings.uriLength).toBe(6); // "1.json"
  });

  it("sizes to the longest remainder, not the first or the average", () => {
    const settings = deriveConfigLineSettings([
      { name: "Item 1", uri: "u/1.json" },
      { name: "Item 20", uri: "u/20.json" },
      { name: "Item 300", uri: "u/300.json" },
    ]);
    // Prefix stops at "Item " / "u/", so the reserved slot must hold "300" and "300.json".
    expect(settings.prefixName).toBe("Item ");
    expect(settings.nameLength).toBe(3);
    expect(settings.uriLength).toBe(8);
  });

  it("counts a shared numeric run as prefix, not as remainder", () => {
    // "#1" and "#1000" share "#1" — the extracted prefix is textual, so the remainder is "000",
    // not the whole number. Worth pinning: it makes the reserved slot smaller than it looks.
    const settings = deriveConfigLineSettings([
      { name: "A #1", uri: "u/1" },
      { name: "A #1000", uri: "u/1000" },
    ]);
    expect(settings.prefixName).toBe("A #1");
    expect(settings.nameLength).toBe(3);
    expect(stripPrefixes([{ name: "A #1000", uri: "u/1000" }], settings)[0].name).toBe("000");
  });

  it("handles items that share everything — a single repeated metadata URI", () => {
    const shared = [
      { name: "One", uri: "https://storage.example/meta.json" },
      { name: "One", uri: "https://storage.example/meta.json" },
    ];
    const settings = deriveConfigLineSettings(shared);
    expect(settings.nameLength).toBe(0);
    expect(settings.uriLength).toBe(0);
    expect(stripPrefixes(shared, settings)).toEqual([
      { name: "", uri: "" },
      { name: "", uri: "" },
    ]);
  });

  it("handles items that share nothing", () => {
    const settings = deriveConfigLineSettings([
      { name: "Alpha", uri: "a://x" },
      { name: "Beta", uri: "b://y" },
    ]);
    expect(settings.prefixName).toBe("");
    expect(settings.prefixUri).toBe("");
    expect(settings.nameLength).toBe(5);
  });

  it("survives a single item", () => {
    const one = [{ name: "Only", uri: "https://storage.example/1.json" }];
    const settings = deriveConfigLineSettings(one);
    // Everything is prefix; nothing is left per line.
    expect(settings.nameLength).toBe(0);
    expect(stripPrefixes(one, settings)).toEqual([{ name: "", uri: "" }]);
  });
});

describe("stripPrefixes", () => {
  it("round-trips: prefix + stored remainder is the original", () => {
    const items: ConfigLineItem[] = [
      { name: "Solarium #1", uri: "https://storage.example/1.json" },
      { name: "Solarium #250", uri: "https://storage.example/250.json" },
    ];
    const settings = deriveConfigLineSettings(items);
    const stored = stripPrefixes(items, settings);
    expect(
      stored.map((s) => ({
        name: settings.prefixName + s.name,
        uri: settings.prefixUri + s.uri,
      }))
    ).toEqual(items);
  });
});

describe("candyMachineAccountSize", () => {
  it("grows with the per-line remainder, which is what prefix extraction buys", () => {
    const naive = candyMachineAccountSize(5000, {
      prefixName: "",
      nameLength: 32,
      prefixUri: "",
      uriLength: 200,
      isSequential: false,
    });
    const prefixed = candyMachineAccountSize(5000, deriveConfigLineSettings(
      Array.from({ length: 5000 }, (_, i) => ({
        name: `Solarium #${i + 1}`,
        uri: "https://storage.example/meta.json",
      }))
    ));
    expect(prefixed).toBeLessThan(naive / 10);
  });

  it("is monotonic in supply", () => {
    const settings = deriveConfigLineSettings([
      { name: "A #1", uri: "u/1.json" },
      { name: "A #2", uri: "u/2.json" },
    ]);
    expect(candyMachineAccountSize(100, settings)).toBeGreaterThan(
      candyMachineAccountSize(10, settings)
    );
  });

  it("charges nothing per line when the remainder is empty", () => {
    const empty = { prefixName: "X", prefixUri: "Y", nameLength: 0, uriLength: 0, isSequential: false };
    const oneByte = { ...empty, nameLength: 1 };
    // The only difference between the two is the config-line area: 1 byte × 8 items.
    expect(candyMachineAccountSize(8, oneByte) - candyMachineAccountSize(8, empty)).toBe(8);
  });
});

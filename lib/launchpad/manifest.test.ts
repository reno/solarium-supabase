import { describe, expect, it } from "vitest";

import {
  buildManifest,
  generateTraits,
  normalizeTraits,
  orderItemFiles,
  parseManifest,
  parseTraitsFile,
  planTraits,
  rankManifest,
  sampleTraitsFile,
  traitLayersOf,
  traitPlanIssue,
  ABSENT_TRAIT_VALUE,
  MAX_DROP_SUPPLY,
  MAX_TRAITS_PER_ITEM,
  MAX_TRAIT_FIELD,
  type ManifestTrait,
} from "./manifest";

const images = (count: number) =>
  Array.from({ length: count }, (_, position) => ({
    index: position + 1,
    url: `https://x/items/${position + 1}.png`,
    type: "image/png",
  }));

describe("orderItemFiles", () => {
  it("orders numerically, not lexicographically", () => {
    const names = orderItemFiles([{ name: "10.png" }, { name: "2.png" }, { name: "1.png" }]).map((f) => f.name);
    expect(names).toEqual(["1.png", "2.png", "10.png"]);
  });
});

describe("parseTraitsFile", () => {
  it("reads a CSV header as the layer names, rows as items in order", () => {
    const parsed = parseTraitsFile("Background,Halo\nVoid,Gold\nDawn,\n", "traits.csv");
    expect(parsed.get(1)).toEqual([
      { trait: "Background", value: "Void" },
      { trait: "Halo", value: "Gold" },
    ]);
    expect(parsed.get(2)).toEqual([
      { trait: "Background", value: "Dawn" },
      { trait: "Halo", value: "" },
    ]);
  });

  it("honours an explicit item column instead of row order", () => {
    const parsed = parseTraitsFile("item,Halo\n7,Gold\n3,Silver\n", "traits.csv");
    expect(parsed.get(7)).toEqual([{ trait: "Halo", value: "Gold" }]);
    expect(parsed.get(3)).toEqual([{ trait: "Halo", value: "Silver" }]);
    expect(parsed.has(1)).toBe(false);
  });

  it("keeps a delimiter inside a quoted value", () => {
    const parsed = parseTraitsFile('Background,Note\nVoid,"black, deep"\n', "traits.csv");
    expect(parsed.get(1)).toEqual([
      { trait: "Background", value: "Void" },
      { trait: "Note", value: "black, deep" },
    ]);
  });

  it("reads a flat JSON object per item", () => {
    const parsed = parseTraitsFile('[{"Background":"Void"},{"Background":"Dawn"}]', "traits.json");
    expect(parsed.get(2)).toEqual([{ trait: "Background", value: "Dawn" }]);
  });

  it("reads an art engine's metaplex attribute export", () => {
    const parsed = parseTraitsFile(
      '[{"index":1,"attributes":[{"trait_type":"Halo","value":"Gold"}]}]',
      "traits.json"
    );
    expect(parsed.get(1)).toEqual([{ trait: "Halo", value: "Gold" }]);
  });

  it("rejects a duplicated item number", () => {
    expect(() => parseTraitsFile("item,Halo\n1,Gold\n1,Silver\n", "traits.csv")).toThrow(/more than once/);
  });

  it("rejects a traits file with no rows", () => {
    expect(() => parseTraitsFile("Background,Halo\n", "traits.csv")).toThrow(/one row per item/);
  });
});

describe("normalizeTraits", () => {
  // An omitted layer would otherwise cost the item a term in recompute_collection_rarity's
  // sum-of-inverse-frequency score, ranking it less rare purely for having fewer traits.
  it("gives every item every layer, writing absences as None", () => {
    const filled = normalizeTraits(
      new Map<number, ManifestTrait[]>([
        [1, [{ trait: "Halo", value: "Gold" }]],
        [2, [{ trait: "Background", value: "Void" }]],
      ])
    );
    expect(filled.get(1)).toEqual([
      { trait: "Halo", value: "Gold" },
      { trait: "Background", value: ABSENT_TRAIT_VALUE },
    ]);
    expect(filled.get(2)).toEqual([
      { trait: "Halo", value: ABSENT_TRAIT_VALUE },
      { trait: "Background", value: "Void" },
    ]);
  });

  it("turns a blank value into None too", () => {
    const filled = normalizeTraits(new Map([[1, [{ trait: "Halo", value: "" }]]]));
    expect(filled.get(1)).toEqual([{ trait: "Halo", value: ABSENT_TRAIT_VALUE }]);
  });
});

describe("buildManifest", () => {
  it("numbers items from the image order and carries their traits", () => {
    const manifest = buildManifest({
      images: images(2),
      traits: parseTraitsFile("Halo\nGold\nSilver\n", "t.csv"),
    });
    expect(manifest.supply).toBe(2);
    expect(manifest.items[0]).toEqual({
      index: 1,
      image: "https://x/items/1.png",
      imageType: "image/png",
      traits: [{ trait: "Halo", value: "Gold" }],
    });
  });

  it("allows a drop with no traits at all", () => {
    const manifest = buildManifest({ images: images(3), traits: null });
    expect(manifest.items.every((item) => item.traits.length === 0)).toBe(true);
  });

  it("rejects a traits file that misses items", () => {
    expect(() => buildManifest({ images: images(3), traits: parseTraitsFile("Halo\nGold\n", "t.csv") })).toThrow(
      /no row for 2 of the 3 items/
    );
  });

  it("rejects a traits file describing artwork that wasn't uploaded", () => {
    expect(() =>
      buildManifest({ images: images(1), traits: parseTraitsFile("item,Halo\n1,Gold\n9,Silver\n", "t.csv") })
    ).toThrow(/no artwork/);
  });

  it("rejects a drop over the supply cap", () => {
    expect(() => buildManifest({ images: images(251), traits: null })).toThrow(/at most 250/);
  });

  it("rejects an empty drop", () => {
    expect(() => buildManifest({ images: [], traits: null })).toThrow(/at least one item/);
  });
});

describe("parseManifest", () => {
  it("round-trips what buildManifest wrote", () => {
    const manifest = buildManifest({ images: images(2), traits: parseTraitsFile("Halo\nGold\nSilver\n", "t.csv") });
    expect(parseManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
  });

  it("rejects a supply that disagrees with the item count", () => {
    const manifest = { ...buildManifest({ images: images(2), traits: null }), supply: 5 };
    expect(() => parseManifest(manifest)).toThrow(/claims 5 items but lists 2/);
  });

  it("rejects an item with no artwork URL", () => {
    const manifest = buildManifest({ images: images(1), traits: null });
    expect(() => parseManifest({ ...manifest, items: [{ ...manifest.items[0], image: "" }] })).toThrow(
      /no artwork URL/
    );
  });

  it("rejects a manifest from a future version", () => {
    expect(() => parseManifest({ version: 2, supply: 0, items: [] })).toThrow(/version 2/);
  });

  // buildManifest applies the cap when a drop is created, but `reveal` reads a manifest back out
  // of storage and then does one service-role upload per item — so the cap has to hold on the
  // parse side too, or an oversized file is a write amplifier for anyone who can trigger a
  // reveal.
  it("rejects a manifest larger than the supply cap", () => {
    const oversized = {
      version: 1,
      supply: MAX_DROP_SUPPLY + 1,
      items: Array.from({ length: MAX_DROP_SUPPLY + 1 }, (_, position) => ({
        index: position + 1,
        image: `https://example.test/${position + 1}.png`,
        imageType: "image/png",
        traits: [],
      })),
    };
    expect(() => parseManifest(oversized)).toThrow(
      new RegExp(`lists ${MAX_DROP_SUPPLY + 1} items; the maximum is ${MAX_DROP_SUPPLY}`)
    );
  });

  it("bounds the traits an item can carry", () => {
    const manifest = buildManifest({ images: images(1), traits: null });
    const parsed = parseManifest({
      ...manifest,
      items: [
        {
          ...manifest.items[0],
          traits: Array.from({ length: 500 }, (_, i) => ({ trait: `t${i}`, value: "x".repeat(1000) })),
        },
      ],
    });
    expect(parsed.items[0].traits).toHaveLength(MAX_TRAITS_PER_ITEM);
    expect(parsed.items[0].traits[0].value.length).toBe(MAX_TRAIT_FIELD);
  });
});

describe("rankManifest", () => {
  const ranked = (csv: string, count: number) =>
    rankManifest(buildManifest({ images: images(count), traits: parseTraitsFile(csv, "t.csv") }));

  it("ranks the scarcest trait first, over the whole pool rather than what has minted", () => {
    // Gold 1/4, Silver 1/4, None 2/4 — the two commons tie and break on item number.
    const result = ranked("Halo\nGold\nSilver\nNone\nNone\n", 4);
    expect(result.map((r) => r.index)).toEqual([1, 2, 3, 4]);
    expect(result.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(result.every((r) => r.total === 4)).toBe(true);
  });

  it("scores an item by summed inverse frequency across layers", () => {
    // Background: Void 2/2 → 2/2 = 1. Halo: Gold 1/2 → 2/1 = 2, Silver 1/2 → 2.
    const result = ranked("Background,Halo\nVoid,Gold\nVoid,Silver\n", 2);
    expect(result.map((r) => r.score)).toEqual([3, 3]);
  });

  it("puts the rarest combination on top", () => {
    const result = ranked("Halo,Eyes\nGold,Laser\nNone,Plain\nNone,Plain\nNone,Plain\n", 4);
    expect(result[0].index).toBe(1);
    expect(result[0].rank).toBe(1);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  // An explicit "None" is a value like any other, so absence is itself rankable — that is the
  // whole reason normalizeTraits fills it in.
  it("treats a rare absence as rare", () => {
    const result = rankManifest(
      buildManifest({ images: images(3), traits: parseTraitsFile("item,Halo\n1,Gold\n2,Gold\n3,\n", "t.csv") })
    );
    expect(result[0].index).toBe(3);
  });

  it("returns nothing for a drop with no traits", () => {
    expect(rankManifest(buildManifest({ images: images(3), traits: null }))).toEqual([]);
  });

  // The two rankings have to agree, because a legacy drop can be ranked by the SQL and a
  // manifest drop by this function, and both surface as nfts.rarity_rank. These four items were
  // run through recompute_collection_rarity() on a local Postgres and came back 2, 3, 1, 4 —
  // including the tie between items 1 and 2, which both sides break on a stable key.
  it("agrees with recompute_collection_rarity on the same traits", () => {
    const result = rankManifest(
      buildManifest({
        images: images(4),
        traits: parseTraitsFile("Halo,Background\nGold,Void\nSilver,Void\nNone,Dawn\nNone,Void\n", "t.csv"),
      })
    );
    const rankOf = new Map(result.map((r) => [r.index, r.rank]));
    expect([1, 2, 3, 4].map((index) => rankOf.get(index))).toEqual([2, 3, 1, 4]);
  });

  it("ranks every item exactly once", () => {
    const result = ranked("Halo\nGold\nSilver\nNone\nNone\nGold\n", 5);
    expect(new Set(result.map((r) => r.rank))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(new Set(result.map((r) => r.index))).toEqual(new Set([1, 2, 3, 4, 5]));
  });
});

describe("traitPlanIssue", () => {
  it("passes a layer that leaves room for None", () => {
    expect(traitPlanIssue([{ trait: "Halo", value: "Gold", percent: 5 }])).toBeNull();
  });

  it("rejects a layer whose values total over 100%", () => {
    expect(
      traitPlanIssue([
        { trait: "Halo", value: "Gold", percent: 60 },
        { trait: "Halo", value: "Silver", percent: 60 },
      ])
    ).toMatch(/add up to 120%/);
  });

  it("accepts values totalling exactly 100% through repeating decimals", () => {
    expect(
      traitPlanIssue([
        { trait: "Halo", value: "A", percent: 33.34 },
        { trait: "Halo", value: "B", percent: 33.33 },
        { trait: "Halo", value: "C", percent: 33.33 },
      ])
    ).toBeNull();
  });

  it("rejects the same value twice in one layer, whatever the casing", () => {
    expect(
      traitPlanIssue([
        { trait: "Halo", value: "Gold", percent: 10 },
        { trait: "halo", value: "gold", percent: 10 },
      ])
    ).toMatch(/twice/);
  });

  it("rejects a blank cell or a zero rarity", () => {
    expect(traitPlanIssue([{ trait: "Halo", value: "", percent: 10 }])).toMatch(/Row 1/);
    expect(traitPlanIssue([{ trait: "Halo", value: "Gold", percent: 0 }])).toMatch(/above 0%/);
  });
});

describe("planTraits", () => {
  it("resolves percentages into item counts, the rest going to None", () => {
    const [layer] = planTraits([{ trait: "Halo", value: "Gold", percent: 5 }], 200);
    expect(layer.values[0].count).toBe(10);
    expect(layer.absent).toBe(190);
  });

  // The wizard shows these counts precisely so a share too small to buy an item is visible
  // rather than silently promised.
  it("shows a share too small to reach one item as zero", () => {
    const [layer] = planTraits([{ trait: "Halo", value: "Gold", percent: 1 }], 20);
    expect(layer.values[0].count).toBe(0);
  });

  // 1% of 50 items is half an item, and half an item is a bigger fraction than the leftover's —
  // rounding it up to one is what keeps a rare value from vanishing on a small drop.
  it("rounds a near-miss share up rather than dropping the value", () => {
    const [layer] = planTraits([{ trait: "Halo", value: "Gold", percent: 1 }], 50);
    expect(layer.values[0].count).toBe(1);
  });

  it("always apportions the whole supply", () => {
    const [layer] = planTraits(
      [
        { trait: "Halo", value: "A", percent: 33.34 },
        { trait: "Halo", value: "B", percent: 33.33 },
        { trait: "Halo", value: "C", percent: 33.33 },
      ],
      10
    );
    expect(layer.values.reduce((sum, { count }) => sum + count, 0) + layer.absent).toBe(10);
  });
});

describe("generateTraits", () => {
  const weights = [
    { trait: "Background", value: "Deep Space", percent: 30 },
    { trait: "Background", value: "Dawn", percent: 70 },
    { trait: "Halo", value: "Gold", percent: 5 },
  ];
  const countOf = (traits: Map<number, ManifestTrait[]>, trait: string, value: string) =>
    [...traits.values()].filter((list) => list.some((t) => t.trait === trait && t.value === value)).length;

  // A percentage is a quota over a pool the machine mints exactly once, not a per-mint chance:
  // sampling would give 7 or 13 Golds out of 200 and make the advertised rarity a lie.
  it("hits the requested share exactly, not on average", () => {
    const traits = generateTraits(weights, 200)!;
    expect(countOf(traits, "Halo", "Gold")).toBe(10);
    expect(countOf(traits, "Background", "Deep Space")).toBe(60);
    expect(countOf(traits, "Background", "Dawn")).toBe(140);
  });

  it("gives the unallocated share of a layer to None", () => {
    const traits = generateTraits(weights, 200)!;
    expect(countOf(traits, "Halo", ABSENT_TRAIT_VALUE)).toBe(190);
  });

  it("gives every item every layer, so their scores stay comparable", () => {
    const traits = generateTraits(weights, 40)!;
    expect(traits.size).toBe(40);
    expect([...traits.values()].every((list) => list.map((t) => t.trait).join() === "Background,Halo")).toBe(true);
  });

  it("is deterministic, so the preview is what gets uploaded", () => {
    expect(generateTraits(weights, 40)).toEqual(generateTraits(weights, 40));
  });

  // Dealing every layer in plan order would stack each layer's rarest value on item 1 — one
  // golden ticket rather than a distribution.
  it("shuffles each layer independently", () => {
    const traits = generateTraits(
      [
        { trait: "A", value: "Yes", percent: 50 },
        { trait: "B", value: "Yes", percent: 50 },
      ],
      40
    )!;
    const same = [...traits.values()].filter(([a, b]) => a.value === b.value).length;
    expect(same).toBeGreaterThan(0);
    expect(same).toBeLessThan(40);
  });

  it("feeds buildManifest and ranks like an uploaded file would", () => {
    const manifest = buildManifest({ images: images(20), traits: generateTraits(weights, 20) });
    const ranked = rankManifest(manifest);
    expect(ranked).toHaveLength(20);
    // Gold is 5% of 20 — one item — so it tops the ranking.
    const gold = manifest.items.find((item) => item.traits.some((t) => t.value === "Gold"))!;
    expect(ranked[0].index).toBe(gold.index);
  });

  it("returns nothing when there is nothing to distribute", () => {
    expect(generateTraits([], 10)).toBeNull();
    expect(generateTraits(weights, 0)).toBeNull();
  });

  it("refuses to generate from a plan it would have rejected", () => {
    expect(() => generateTraits([{ trait: "Halo", value: "Gold", percent: 0 }], 10)).toThrow(/above 0%/);
  });
});

describe("sampleTraitsFile", () => {
  it("hands back a template the wizard's own parser accepts", () => {
    for (const format of ["csv", "json"] as const) {
      const parsed = parseTraitsFile(sampleTraitsFile(format, 12), `sample.${format}`);
      expect(parsed.size).toBe(12);
      expect(() => buildManifest({ images: images(12), traits: parsed })).not.toThrow();
    }
  });

  it("stays readable for a creator who has not uploaded artwork yet", () => {
    expect(parseTraitsFile(sampleTraitsFile("csv", 0), "sample.csv").size).toBe(3);
  });
});

describe("traitLayersOf", () => {
  it("lists each layer once", () => {
    expect(traitLayersOf(parseTraitsFile("Background,Halo\nVoid,Gold\nDawn,Silver\n", "t.csv"))).toEqual([
      "Background",
      "Halo",
    ]);
  });
});

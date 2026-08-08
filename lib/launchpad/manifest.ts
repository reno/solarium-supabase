/**
 * Authoring a drop manifest — the per-item half of a generative drop.
 *
 * A candy machine config line carries only a URI (`{n}.json`), so an item's artwork and its
 * traits exist nowhere on chain: they live in that JSON, which the `candy-mint` edge function
 * reads back into `nfts.image_url` and `nfts.traits`. The manifest is what the creator uploads
 * once, at drop-creation time, so the deploy step knows which image and which attributes belong
 * to item #n instead of stamping the collection cover onto all of them.
 *
 * Rarity is *not* a per-mint probability — candy machine mints each config line exactly once, so
 * a trait is rare because few items in the pool carry it. The manifest is therefore the only
 * place rarity is decided, and `rankManifest` settles it before a single item mints.
 *
 * The format itself (types, paths, `parseManifest`) lives in supabase/functions/_shared and is
 * re-exported here, because the `reveal` edge function reads manifests too.
 */

export * from "@/supabase/functions/_shared/manifest";

import {
  ABSENT_TRAIT_VALUE,
  MANIFEST_VERSION,
  MAX_DROP_SUPPLY,
  type DropManifest,
  type ManifestTrait,
} from "@/supabase/functions/_shared/manifest";

export function extensionOf(filename: string): string {
  return filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : "png";
}

// "10.png" must not sort ahead of "2.png": when the traits file doesn't name indices, file order
// is item order, and a lexicographic sort would silently shuffle the whole drop.
const NATURAL = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function orderItemFiles<T extends { name: string }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => NATURAL.compare(a.name, b.name));
}

const INDEX_KEYS = new Set(["item", "index", "number", "#"]);

function isIndexKey(key: string): boolean {
  return INDEX_KEYS.has(key.trim().toLowerCase());
}

// A single scanner rather than split("\n"): a quoted trait value may contain the delimiter or a
// newline, and losing either one silently misaligns every column after it.
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

function parseTraitsDelimited(text: string, delimiter: string): Map<number, ManifestTrait[]> {
  const rows = parseDelimited(text, delimiter);
  if (rows.length < 2) {
    throw new Error("The traits file needs a header row naming the layers, then one row per item.");
  }
  const header = rows[0].map((name) => name.trim());
  const indexColumn = header.findIndex(isIndexKey);
  const byIndex = new Map<number, ManifestTrait[]>();

  rows.slice(1).forEach((cells, position) => {
    const index = indexColumn >= 0 ? Number(cells[indexColumn]?.trim()) : position + 1;
    if (!Number.isInteger(index) || index < 1) {
      throw new Error(
        `Row ${position + 2} of the traits file has "${cells[indexColumn] ?? ""}" where an item number should be.`
      );
    }
    if (byIndex.has(index)) {
      throw new Error(`The traits file lists item ${index} more than once.`);
    }
    byIndex.set(
      index,
      header
        .map((trait, column) => ({ trait, value: (cells[column] ?? "").trim(), column }))
        .filter(({ trait, column }) => column !== indexColumn && trait !== "")
        .map(({ trait, value }) => ({ trait, value }))
    );
  });
  return byIndex;
}

function traitsFromEntry(entry: Record<string, unknown>): ManifestTrait[] {
  // An art engine's export is usually already in Metaplex attribute shape; a hand-written file is
  // usually a flat layer→value object. Both are obvious to a human, so accept both.
  const attributes = entry.attributes;
  if (Array.isArray(attributes)) {
    return attributes
      .map((attribute) => {
        const record = (attribute ?? {}) as Record<string, unknown>;
        return {
          trait: String(record.trait_type ?? record.trait ?? "").trim(),
          value: record.value == null ? "" : String(record.value).trim(),
        };
      })
      .filter(({ trait }) => trait !== "");
  }
  return Object.entries(entry)
    .filter(([key]) => !isIndexKey(key))
    .map(([trait, value]) => ({
      trait: trait.trim(),
      value: value == null ? "" : String(value).trim(),
    }))
    .filter(({ trait }) => trait !== "");
}

function parseTraitsJson(text: string): Map<number, ManifestTrait[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The traits file is not valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("The traits JSON has to be an array with one entry per item.");
  }
  const byIndex = new Map<number, ManifestTrait[]>();
  parsed.forEach((raw, position) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`Entry ${position + 1} of the traits file is not an object.`);
    }
    const entry = raw as Record<string, unknown>;
    const declared = Object.keys(entry).find(isIndexKey);
    const index = declared ? Number(entry[declared]) : position + 1;
    if (!Number.isInteger(index) || index < 1) {
      throw new Error(`Entry ${position + 1} of the traits file has an invalid item number.`);
    }
    if (byIndex.has(index)) {
      throw new Error(`The traits file lists item ${index} more than once.`);
    }
    byIndex.set(index, traitsFromEntry(entry));
  });
  return byIndex;
}

export function parseTraitsFile(text: string, filename: string): Map<number, ManifestTrait[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return parseTraitsJson(text);
  if (lower.endsWith(".tsv")) return parseTraitsDelimited(text, "\t");
  return parseTraitsDelimited(text, ",");
}

// Every item gets every layer, in first-seen order, with absences written as "None".
export function normalizeTraits(byIndex: Map<number, ManifestTrait[]>): Map<number, ManifestTrait[]> {
  const layers: string[] = [];
  for (const traits of byIndex.values()) {
    for (const { trait } of traits) {
      if (!layers.includes(trait)) layers.push(trait);
    }
  }
  const filled = new Map<number, ManifestTrait[]>();
  for (const [index, traits] of byIndex) {
    const own = new Map(traits.map(({ trait, value }) => [trait, value]));
    filled.set(
      index,
      layers.map((trait) => {
        const value = own.get(trait)?.trim();
        return { trait, value: value ? value : ABSENT_TRAIT_VALUE };
      })
    );
  }
  return filled;
}

/**
 * Generating a distribution instead of uploading one.
 *
 * A percentage here is a **quota over the fixed pool, not a per-mint probability**: candy machine
 * mints each config line exactly once, so "5% Gold" has to mean exactly 5% of the items carry
 * Gold, decided now. Sampling per item would land on 7 or 13 out of 200 and quietly make the
 * advertised rarity false, so the shares are apportioned by largest remainder and then dealt out
 * shuffled. The unallocated share of a layer becomes "None", which is a real value here — see
 * ABSENT_TRAIT_VALUE — so a layer only 5% of items carry is itself the rare thing.
 */
export type TraitWeight = { trait: string; value: string; percent: number };

export type TraitPlanLayer = {
  trait: string;
  values: { value: string; percent: number; count: number }[];
  absent: number; // items taking "None" for this layer, i.e. whatever the percentages left over
};

// Layers are grouped case-insensitively but keep their first-seen spelling, so "background" and
// "Background" can't become two layers that each fill the other with "None".
function groupWeights(rows: readonly TraitWeight[]): { trait: string; values: TraitWeight[] }[] {
  const layers = new Map<string, { trait: string; values: TraitWeight[] }>();
  for (const row of rows) {
    const trait = row.trait.trim();
    const key = trait.toLowerCase();
    const layer = layers.get(key) ?? { trait, values: [] };
    layer.values.push({ trait, value: row.value.trim(), percent: row.percent });
    layers.set(key, layer);
  }
  return [...layers.values()];
}

export function traitPlanIssue(rows: readonly TraitWeight[]): string | null {
  for (const [position, row] of rows.entries()) {
    if (row.trait.trim() === "" || row.value.trim() === "") {
      return `Row ${position + 1} needs both a trait and a value.`;
    }
    if (!Number.isFinite(row.percent) || row.percent <= 0) {
      return `Give ${row.trait.trim()} · ${row.value.trim()} a rarity above 0%.`;
    }
  }
  for (const { trait, values } of groupWeights(rows)) {
    const seen = new Set<string>();
    for (const { value } of values) {
      if (seen.has(value.toLowerCase())) return `${trait} lists "${value}" twice.`;
      seen.add(value.toLowerCase());
    }
    // Rounded, so three values at 33.34 read as 100 rather than failing by a hundredth.
    const total = Math.round(values.reduce((sum, { percent }) => sum + percent, 0) * 100) / 100;
    if (total > 100) {
      return `${trait}'s values add up to ${total}% — they can total at most 100%, and whatever is left becomes "None".`;
    }
  }
  return null;
}

// Largest remainder: floor every share, then hand the leftover items to the biggest fractions.
// Ties go to the earlier bucket and "None" is always last, so a 5%-of-20-items value lands its
// one item rather than losing the rounding to the layer's leftover.
function apportion(shares: readonly number[], total: number): number[] {
  const exact = shares.map((share) => (share / 100) * total);
  const counts = exact.map((value) => Math.floor(value));
  const order = exact
    .map((value, position) => ({ position, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.position - b.position);
  let left = total - counts.reduce((sum, count) => sum + count, 0);
  for (let i = 0; left > 0 && i < order.length; i++, left--) counts[order[i].position]++;
  return counts;
}

/**
 * Resolve percentages into the item counts they actually produce, so the wizard can show what a
 * creator is about to get. 1% of a 50-item drop is half an item and rounds to none of them —
 * better to see the 0 than to be told 1% and shipped nothing.
 */
export function planTraits(rows: readonly TraitWeight[], supply: number): TraitPlanLayer[] {
  return groupWeights(rows).map(({ trait, values }) => {
    const declared = values.reduce((sum, { percent }) => sum + percent, 0);
    const counts = apportion([...values.map(({ percent }) => percent), Math.max(0, 100 - declared)], supply);
    return {
      trait,
      values: values.map(({ value, percent }, position) => ({ value, percent, count: counts[position] })),
      absent: counts[counts.length - 1],
    };
  });
}

// Seeded so the counts the wizard previews are the ones it uploads, and so a re-render doesn't
// reshuffle a drop the creator was already looking at.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

function shuffle<T>(values: T[], random: () => number): T[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

/**
 * Deal the planned counts out across the drop, in the same shape `parseTraitsFile` returns so the
 * wizard can't tell a generated drop from an uploaded one.
 *
 * Each layer is shuffled on its own seed: dealing them all in plan order would put every layer's
 * rarest value on item 1, which is not a distribution but a single golden ticket.
 */
export function generateTraits(rows: readonly TraitWeight[], supply: number): Map<number, ManifestTrait[]> | null {
  const issue = traitPlanIssue(rows);
  if (issue) throw new Error(issue);
  if (rows.length === 0 || supply < 1) return null;

  const plan = planTraits(rows, supply);
  const seed = seedFrom(JSON.stringify([supply, rows]));
  const byIndex = new Map<number, ManifestTrait[]>();
  for (let index = 1; index <= supply; index++) byIndex.set(index, []);

  plan.forEach((layer, position) => {
    const pool: string[] = [];
    for (const { value, count } of layer.values) {
      for (let i = 0; i < count; i++) pool.push(value);
    }
    while (pool.length < supply) pool.push(ABSENT_TRAIT_VALUE);
    shuffle(pool, mulberry32(seed + position * 0x9e3779b9)).forEach((value, offset) => {
      byIndex.get(offset + 1)?.push({ trait: layer.trait, value });
    });
  });
  return byIndex;
}

// A template rather than a toy: it is numbered for the drop the creator has actually uploaded, so
// the file they download is the file they can fill in and hand back.
const SAMPLE_LAYERS: { trait: string; values: string[] }[] = [
  { trait: "Background", values: ["Deep Space", "Dawn", "Dusk"] },
  { trait: "Body", values: ["Chrome", "Matte"] },
  { trait: "Halo", values: ["Gold", ABSENT_TRAIT_VALUE, ABSENT_TRAIT_VALUE, ABSENT_TRAIT_VALUE] },
];

export function sampleTraitsFile(format: "csv" | "json", supply: number): string {
  const rows = Math.min(Math.max(supply, 3), MAX_DROP_SUPPLY);
  const cell = (layer: (typeof SAMPLE_LAYERS)[number], index: number) => layer.values[index % layer.values.length];

  if (format === "json") {
    return `${JSON.stringify(
      Array.from({ length: rows }, (_, position) => ({
        item: position + 1,
        ...Object.fromEntries(SAMPLE_LAYERS.map((layer) => [layer.trait, cell(layer, position)])),
      })),
      null,
      2
    )}\n`;
  }
  const header = ["item", ...SAMPLE_LAYERS.map(({ trait }) => trait)].join(",");
  const body = Array.from({ length: rows }, (_, position) =>
    [position + 1, ...SAMPLE_LAYERS.map((layer) => cell(layer, position))].join(",")
  );
  return `${[header, ...body].join("\n")}\n`;
}

export function traitLayersOf(byIndex: Map<number, ManifestTrait[]>): string[] {
  const layers = new Set<string>();
  for (const traits of byIndex.values()) {
    for (const { trait } of traits) layers.add(trait);
  }
  return [...layers];
}

function listShort(numbers: number[]): string {
  const head = numbers.slice(0, 5).join(", ");
  return numbers.length > 5 ? `${head} +${numbers.length - 5} more` : head;
}

export function buildManifest({
  images,
  traits,
}: {
  images: { index: number; url: string; type: string }[];
  traits: Map<number, ManifestTrait[]> | null;
}): DropManifest {
  const supply = images.length;
  if (supply < 1) {
    throw new Error("Add at least one item image — the drop's supply is how many you upload.");
  }
  if (supply > MAX_DROP_SUPPLY) {
    throw new Error(`A drop holds at most ${MAX_DROP_SUPPLY} items, and you added ${supply}.`);
  }

  const seen = new Set<number>();
  for (const { index } of images) {
    if (!Number.isInteger(index) || index < 1 || index > supply) {
      throw new Error(`Item numbers have to run 1 to ${supply}, and one of them is ${index}.`);
    }
    if (seen.has(index)) throw new Error(`Item ${index} appears twice.`);
    seen.add(index);
  }

  if (traits) {
    const orphans = [...traits.keys()].filter((index) => !seen.has(index)).sort((a, b) => a - b);
    if (orphans.length > 0) {
      throw new Error(`The traits file describes items with no artwork: ${listShort(orphans)}.`);
    }
    const missing = [...seen].filter((index) => !traits.has(index)).sort((a, b) => a - b);
    if (missing.length > 0) {
      throw new Error(`The traits file has no row for ${missing.length} of the ${supply} items: ${listShort(missing)}.`);
    }
  }

  const filled = traits ? normalizeTraits(traits) : null;
  return {
    version: MANIFEST_VERSION,
    supply,
    items: [...images]
      .sort((a, b) => a.index - b.index)
      .map(({ index, url, type }) => ({
        index,
        image: url,
        imageType: type || "image/png",
        traits: filled?.get(index) ?? [],
      })),
  };
}

export type ItemRarity = { index: number; score: number; rank: number; total: number };

/**
 * Rank the whole drop before any of it mints.
 *
 * `recompute_collection_rarity()` ranks the rows in `nfts`, and those only exist once a buyer
 * has minted — so mid-drop its frequencies describe whatever fraction has sold, and every rank
 * churns until sellout. A candy machine mints each config line exactly once, so the full trait
 * distribution is already fixed here, in the manifest.
 *
 * The formula mirrors the SQL exactly so the two agree on any collection they both see: an
 * item's score is the sum over its traits of (items carrying that trait) / (items sharing that
 * exact value), i.e. inverse frequency, and higher is rarer. Ties break on item number where
 * the SQL breaks on nft id — both are arbitrary but deterministic.
 *
 * Returns [] for a drop with no traits at all: rarity is not a real quantity there, and a null
 * rank is the honest answer rather than a ranking of identical zero scores.
 */
export function rankManifest(manifest: DropManifest): ItemRarity[] {
  const key = (trait: string, value: string) => `${trait} ${value}`;
  const carrying = new Map<string, number>();
  const sharing = new Map<string, number>();

  for (const item of manifest.items) {
    for (const { trait, value } of item.traits) {
      carrying.set(trait, (carrying.get(trait) ?? 0) + 1);
      sharing.set(key(trait, value), (sharing.get(key(trait, value)) ?? 0) + 1);
    }
  }
  if (carrying.size === 0) return [];

  const total = manifest.items.length;
  return manifest.items
    .map((item) => ({
      index: item.index,
      score: item.traits.reduce((sum, { trait, value }) => {
        const shared = sharing.get(key(trait, value)) ?? 0;
        return shared > 0 ? sum + (carrying.get(trait) ?? 0) / shared : sum;
      }, 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ index, score }, position) => ({ index, score, rank: position + 1, total }));
}

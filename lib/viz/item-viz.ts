function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export function orderBook(
  askPrices: number[],
  bidPrices: number[]
): { bids: { price: number; size: number }[]; asks: { price: number; size: number }[] } {
  const levels = (prices: number[], dir: "asc" | "desc") => {
    const m = new Map<number, number>();
    for (const p of prices) m.set(p, (m.get(p) ?? 0) + 1);
    return [...m.entries()]
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => (dir === "asc" ? a.price - b.price : b.price - a.price));
  };
  return { asks: levels(askPrices, "asc"), bids: levels(bidPrices, "desc") };
}

export function rarityBuckets(id: string, rank: number | null, total: number): { buckets: { label: string; count: number }[]; highlight: number } {
  const r = rng(hash(id) ^ 0x9e3779b9);
  const n = 28;
  const buckets = Array.from({ length: n }, (_, i) => ({ label: `b${i}`, count: Math.round(30 + 70 * Math.sin(i / 4 + 1) + i * 2 + r() * 20) }));
  const highlight = rank != null && total > 0 ? Math.min(n - 1, Math.floor((rank / total) * n)) : Math.floor(n / 3);
  return { buckets, highlight };
}

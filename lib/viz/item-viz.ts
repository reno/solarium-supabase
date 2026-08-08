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

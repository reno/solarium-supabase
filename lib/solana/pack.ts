import type { TransactionBuilder, Umi } from "@metaplex-foundation/umi";

export type TxChunk<T> = {
  builder: TransactionBuilder;
  keys: T[];
};

export function packIntoTransactions<T>(
  umi: Umi,
  items: { builder: TransactionBuilder; keys: T[] }[]
): TxChunk<T>[] {
  const chunks: TxChunk<T>[] = [];
  for (const item of items) {
    const last = chunks[chunks.length - 1];
    if (last) {
      const merged = last.builder.add(item.builder);
      if (merged.fitsInOneTransaction(umi)) {
        last.builder = merged;
        last.keys.push(...item.keys);
        continue;
      }
    }
    chunks.push({ builder: item.builder, keys: [...item.keys] });
  }
  return chunks;
}

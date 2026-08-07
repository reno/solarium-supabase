import type { TransactionBuilder, Umi } from "@metaplex-foundation/umi";

export type TxChunk<T> = {
  builder: TransactionBuilder;
  /** What this transaction carries — used to record exactly what landed. */
  keys: T[];
};

/**
 * Greedily pack builders into as few transactions as possible, appending to the current chunk
 * while it still fits inside one transaction and starting a new one when it doesn't.
 *
 * This is what keeps multi-item flows to a handful of wallet approvals: the wallet bridge signs
 * one transaction per prompt (see lib/solana/umi.ts), so fewer transactions is fewer prompts.
 * Order is preserved, and each chunk reports its own keys so a partial failure can still record
 * the items that made it on chain.
 */
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

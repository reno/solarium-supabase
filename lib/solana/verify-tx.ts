import type { Transaction } from "@metaplex-foundation/umi";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const SYSTEM_TRANSFER = 2;

export function buyerLamportsIn(transaction: Transaction): bigint {
  const { accounts, instructions } = transaction.message;
  const payer = accounts[0];
  let total = 0n;

  for (const instruction of instructions) {
    if (accounts[instruction.programIndex] !== SYSTEM_PROGRAM) continue;
    if (instruction.data.length < 12) continue;
    const view = new DataView(
      instruction.data.buffer,
      instruction.data.byteOffset,
      instruction.data.byteLength
    );
    if (view.getUint32(0, true) !== SYSTEM_TRANSFER) continue;
    const from = accounts[instruction.accountIndexes[0]];
    if (from !== payer) continue;
    total += view.getBigUint64(4, true);
  }

  return total;
}

export function assertBuyerCost(transaction: Transaction, maxLamports: bigint): void {
  const cost = buyerLamportsIn(transaction);
  if (cost > maxLamports) {
    throw new Error(
      `This transaction would take ${cost} lamports, more than the ${maxLamports} you approved. Nothing was signed.`
    );
  }
}

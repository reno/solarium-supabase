import type { Transaction } from "@metaplex-foundation/umi";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
// System program instruction discriminator for Transfer, little-endian u32.
const SYSTEM_TRANSFER = 2;

/**
 * Total lamports this transaction moves out of the fee payer via System Program transfers.
 *
 * Deliberately narrow. It is not a general transaction simulator — it answers one question:
 * how much SOL is the signer being asked to hand over? For a settlement that is the whole cost
 * (price + marketplace fee + creator royalty), because those are the only value-bearing legs;
 * the Core transfer moves an asset, not lamports, and rent and network fees are not System
 * transfers from the payer.
 */
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
    // Transfer takes [from, to]; only count what leaves the account doing the signing.
    const from = accounts[instruction.accountIndexes[0]];
    if (from !== payer) continue;
    total += view.getBigUint64(4, true);
  }

  return total;
}

/**
 * Refuse to sign a transaction that costs more than the user was quoted.
 *
 * The settlement transaction is built and signed by the marketplace's edge function and handed
 * to the browser as an opaque base64 blob. Signing it without looking means the only thing
 * standing between the user and an arbitrary transfer is whatever their wallet chooses to
 * render. This does not verify that the transaction is *correct* — the server composed it and
 * knows the price — but it does bound the damage to the number the user actually approved.
 */
export function assertBuyerCost(transaction: Transaction, maxLamports: bigint): void {
  const cost = buyerLamportsIn(transaction);
  if (cost > maxLamports) {
    throw new Error(
      `This transaction would take ${cost} lamports, more than the ${maxLamports} you approved. Nothing was signed.`
    );
  }
}

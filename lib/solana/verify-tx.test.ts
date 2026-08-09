import type { Transaction } from "@metaplex-foundation/umi";
import { describe, expect, it } from "vitest";

import { assertBuyerCost, buyerLamportsIn } from "@/lib/solana/verify-tx";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const BUYER = "BuyerWa11et1111111111111111111111111111111";
const SELLER = "Se11erWa11et111111111111111111111111111111";
const TREASURY = "Treasury1111111111111111111111111111111111";
const CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";

function transferData(lamports: bigint): Uint8Array {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return data;
}

function txOf(
  accounts: string[],
  instructions: { programIndex: number; accountIndexes: number[]; data: Uint8Array }[]
): Transaction {
  return { message: { accounts, instructions } } as unknown as Transaction;
}

describe("buyerLamportsIn", () => {
  it("sums the legs the fee payer funds", () => {
    const tx = txOf(
      [BUYER, SELLER, TREASURY, SYSTEM_PROGRAM],
      [
        { programIndex: 3, accountIndexes: [0, 1], data: transferData(1_000_000_000n) },
        { programIndex: 3, accountIndexes: [0, 2], data: transferData(10_000_000n) },
      ]
    );
    expect(buyerLamportsIn(tx)).toBe(1_010_000_000n);
  });

  it("ignores transfers the buyer is not paying for", () => {
    const tx = txOf(
      [BUYER, SELLER, TREASURY, SYSTEM_PROGRAM],
      [{ programIndex: 3, accountIndexes: [1, 2], data: transferData(5_000_000_000n) }]
    );
    expect(buyerLamportsIn(tx)).toBe(0n);
  });

  it("ignores non-System programs and non-Transfer instructions", () => {
    const notTransfer = new Uint8Array(12);
    new DataView(notTransfer.buffer).setUint32(0, 3, true);
    const tx = txOf(
      [BUYER, SELLER, SYSTEM_PROGRAM, CORE_PROGRAM],
      [
        { programIndex: 3, accountIndexes: [0, 1], data: transferData(9_000_000_000n) },
        { programIndex: 2, accountIndexes: [0, 1], data: notTransfer },
      ]
    );
    expect(buyerLamportsIn(tx)).toBe(0n);
  });

  it("does not read past a truncated instruction", () => {
    const tx = txOf(
      [BUYER, SELLER, SYSTEM_PROGRAM],
      [{ programIndex: 2, accountIndexes: [0, 1], data: new Uint8Array([2, 0, 0, 0]) }]
    );
    expect(buyerLamportsIn(tx)).toBe(0n);
  });
});

describe("assertBuyerCost", () => {
  const tx = txOf(
    [BUYER, SELLER, SYSTEM_PROGRAM],
    [{ programIndex: 2, accountIndexes: [0, 1], data: transferData(1_000_000_000n) }]
  );

  it("allows a transaction that costs exactly what was quoted", () => {
    expect(() => assertBuyerCost(tx, 1_000_000_000n)).not.toThrow();
  });

  it("allows a transaction that costs less than quoted", () => {
    expect(() => assertBuyerCost(tx, 1_050_000_000n)).not.toThrow();
  });

  it("refuses a transaction that would take more than the user approved", () => {
    expect(() => assertBuyerCost(tx, 999_999_999n)).toThrow(/more than the 999999999 you approved/);
  });
});

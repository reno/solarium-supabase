import type { Umi } from "@metaplex-foundation/umi";
import { describe, expect, it, vi } from "vitest";

import { confirmTransaction } from "@/lib/solana/confirm";

const SIGNATURE = new Uint8Array(64).fill(7);
const WINDOW = { blockhash: "H1x…", lastValidBlockHeight: 100 };

const EXPIRED = new Error(
  "Signature W2trZmzGnWZTrbgQ64L7FeM2idHmHWhbnd5Z6hzMwPZUPiZL8MMVi1EH4c3CCbCas4Z4LgFaBcByuPHy6maUNY5 has expired: block height exceeded."
);

function umiWith(rpc: Partial<Umi["rpc"]>): Umi {
  return { rpc } as unknown as Umi;
}

const status = (error: unknown = null) => ({ slot: 1, confirmations: null, error, commitment: "finalized" });

describe("confirmTransaction", () => {
  it("returns as soon as the transaction confirms normally", async () => {
    const getSignatureStatuses = vi.fn();
    const umi = umiWith({ confirmTransaction: vi.fn().mockResolvedValue(undefined), getSignatureStatuses });
    await expect(confirmTransaction(umi, SIGNATURE, WINDOW)).resolves.toBeUndefined();
    expect(getSignatureStatuses).not.toHaveBeenCalled();
  });

  it("succeeds when the strategy says expired but the signature actually landed", async () => {
    const umi = umiWith({
      confirmTransaction: vi.fn().mockRejectedValue(EXPIRED),
      getSignatureStatuses: vi.fn().mockResolvedValue([status()]),
    });
    await expect(confirmTransaction(umi, SIGNATURE, WINDOW)).resolves.toBeUndefined();
  });

  it("reports a transaction that landed and was rejected on chain", async () => {
    const umi = umiWith({
      confirmTransaction: vi.fn().mockRejectedValue(EXPIRED),
      getSignatureStatuses: vi.fn().mockResolvedValue([status({ InstructionError: [0, "Custom"] })]),
    });
    await expect(confirmTransaction(umi, SIGNATURE, WINDOW)).rejects.toThrow(/rejected on chain/);
  });

  it("keeps the original expiry error when the signature really is not there", async () => {
    const umi = umiWith({
      confirmTransaction: vi.fn().mockRejectedValue(EXPIRED),
      getSignatureStatuses: vi.fn().mockResolvedValue([null]),
    });
    await expect(confirmTransaction(umi, SIGNATURE, WINDOW)).rejects.toThrow(/block height exceeded/);
  });

  it("polls before concluding the signature is absent", async () => {
    const getSignatureStatuses = vi
      .fn()
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([status()]);
    const umi = umiWith({
      confirmTransaction: vi.fn().mockRejectedValue(EXPIRED),
      getSignatureStatuses,
    });
    await expect(confirmTransaction(umi, SIGNATURE, WINDOW)).resolves.toBeUndefined();
    expect(getSignatureStatuses).toHaveBeenCalledTimes(2);
  });

  it("does not let a failing status lookup swallow the original error", async () => {
    const umi = umiWith({
      confirmTransaction: vi.fn().mockRejectedValue(EXPIRED),
      getSignatureStatuses: vi.fn().mockRejectedValue(new Error("rpc down")),
    });
    await expect(confirmTransaction(umi, SIGNATURE, WINDOW)).rejects.toThrow(/block height exceeded/);
  });
});

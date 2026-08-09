import type { BlockhashWithExpiryBlockHeight, TransactionSignature, Umi } from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";

import { withRpcRetry } from "@/lib/solana/retry";

export async function confirmTransaction(
  umi: Umi,
  signature: TransactionSignature,
  blockhash: BlockhashWithExpiryBlockHeight | { blockhash: string; lastValidBlockHeight: number }
): Promise<void> {
  try {
    await withRpcRetry(() =>
      umi.rpc.confirmTransaction(signature, {
        strategy: {
          type: "blockhash",
          blockhash: blockhash.blockhash,
          lastValidBlockHeight: Number(blockhash.lastValidBlockHeight),
        },
      })
    );
    return;
  } catch (expiryError) {
    const landed = await didLand(umi, signature);
    if (landed === "succeeded") return;
    if (landed === "failed") {
      throw new Error("The transaction was rejected on chain. Nothing was charged beyond network fees.");
    }
    throw expiryError;
  }
}

type Landed = "succeeded" | "failed" | "absent";

async function didLand(umi: Umi, signature: TransactionSignature): Promise<Landed> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const [status] = await withRpcRetry(() =>
        umi.rpc.getSignatureStatuses([signature], { searchTransactionHistory: true })
      );
      if (status) return status.error ? "failed" : "succeeded";
    } catch {
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  return "absent";
}

export function signatureString(signature: TransactionSignature): string {
  return base58.deserialize(signature)[0];
}

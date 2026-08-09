import type { BlockhashWithExpiryBlockHeight, TransactionSignature, Umi } from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";

import { withRpcRetry } from "@/lib/solana/retry";

/**
 * Confirm a transaction, and treat "block height exceeded" as a question rather than an answer.
 *
 * The blockhash strategy stops polling once the network passes `lastValidBlockHeight` and reports
 * the signature as expired. That is the correct conclusion *most* of the time — but it is drawn
 * from the absence of a confirmation, not from evidence of failure, and a transaction that landed
 * near the boundary (or whose confirmation polls were paced out by the rate limiter in
 * lib/solana/throttle.ts) produces exactly the same absence.
 *
 * Getting that wrong is expensive here, because every caller does something irreversible before
 * confirming and something necessary after: a listing grants the settlement authority a transfer
 * delegate on chain and *then* writes the row; a purchase pays out and *then* records the sale.
 * A false "expired" leaves the chain updated and the database not, which is the one state this
 * app has no way to repair on its own.
 *
 * So on expiry we ask the network directly whether the signature landed. Only if it truly is not
 * there does the failure stand.
 */
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

/**
 * Ask whether a signature is on chain. Polled a few times: a transaction can be in flight at the
 * moment the blockhash window closes, and answering "absent" too eagerly recreates the very
 * false negative this exists to catch.
 */
async function didLand(umi: Umi, signature: TransactionSignature): Promise<Landed> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const [status] = await withRpcRetry(() =>
        umi.rpc.getSignatureStatuses([signature], { searchTransactionHistory: true })
      );
      if (status) return status.error ? "failed" : "succeeded";
    } catch {
      // A failed status lookup says nothing either way; fall through and try again.
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
  return "absent";
}

/** The base58 signature string, for logs and explorer links. */
export function signatureString(signature: TransactionSignature): string {
  return base58.deserialize(signature)[0];
}

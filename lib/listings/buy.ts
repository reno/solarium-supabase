import type { Umi } from "@metaplex-foundation/umi";
import { base58, base64 } from "@metaplex-foundation/umi/serializers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { invokeSettle } from "@/lib/settle/invoke";
import { withRpcRetry } from "@/lib/solana/retry";
import { assertBuyerCost } from "@/lib/solana/verify-tx";
import { confirmTransaction } from "@/lib/solana/confirm";

export type BuyStage = "preparing" | "signing" | "sending" | "confirming" | "recording";

export async function buyListing({
  supabase,
  umi,
  listingId,
  maxLamports,
  onStage,
}: {
  supabase: SupabaseClient;
  umi: Umi;
  listingId: string;
  maxLamports?: bigint;
  onStage?: (stage: BuyStage) => void;
}): Promise<{ signature: string }> {
  onStage?.("preparing");
  const prepared = await invokeSettle(supabase, { action: "prepare", listingId });

  const transaction = umi.transactions.deserialize(
    base64.serialize(prepared.transaction)
  );

  if (maxLamports !== undefined) assertBuyerCost(transaction, maxLamports);

  onStage?.("signing");
  const signed = await umi.identity.signTransaction(transaction);

  onStage?.("sending");
  const signatureBytes = await withRpcRetry(() => umi.rpc.sendTransaction(signed));

  onStage?.("confirming");
  await confirmTransaction(umi, signatureBytes, {
    blockhash: prepared.blockhash,
    lastValidBlockHeight: Number(prepared.lastValidBlockHeight),
  });
  const signature = base58.deserialize(signatureBytes)[0];

  onStage?.("recording");
  try {
    await invokeSettle(supabase, { action: "confirm", listingId, signature });
  } catch (e) {
    throw new Error(
      `Your purchase landed on chain (tx ${signature}) but recording it failed: ${
        e instanceof Error ? e.message : e
      }. Reload the page — if it still shows as listed, contact support with the transaction signature.`
    );
  }
  return { signature };
}

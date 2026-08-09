import { mplCore } from "@metaplex-foundation/mpl-core";
import {
  publicKey as umiPublicKey,
  signerIdentity,
  type Signer as UmiSigner,
  type Transaction as UmiTransaction,
  type Umi,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  getTransactionDecoder,
  getTransactionEncoder,
  type Transaction as KitTransaction,
  type TransactionModifyingSigner,
} from "@solana/kit";

import { getRpcUrl } from "@/lib/solana/config";
import { throttledFetch } from "@/lib/solana/throttle";

function toUmiSigner(
  umi: Umi,
  kitSigner: TransactionModifyingSigner
): UmiSigner {
  const decoder = getTransactionDecoder();
  const encoder = getTransactionEncoder();
  return {
    publicKey: umiPublicKey(kitSigner.address),
    signMessage() {
      return Promise.reject(
        new Error("Message signing is not supported by this signer.")
      );
    },
    async signTransaction(transaction: UmiTransaction) {
      const kitTransaction = decoder.decode(
        umi.transactions.serialize(transaction)
      ) as KitTransaction;
      const [signed] = await kitSigner.modifyAndSignTransactions([
        kitTransaction,
      ]);
      return umi.transactions.deserialize(
        new Uint8Array(encoder.encode(signed))
      );
    },
    async signAllTransactions(transactions: UmiTransaction[]) {
      const signed: UmiTransaction[] = [];
      for (const transaction of transactions) {
        signed.push(await this.signTransaction(transaction));
      }
      return signed;
    },
  };
}

export function createUmiForWallet(
  kitSigner: TransactionModifyingSigner
): Umi {
  const umi = createUmi(getRpcUrl(), {
    commitment: "confirmed",
    fetch: throttledFetch,
  }).use(mplCore());
  umi.use(signerIdentity(toUmiSigner(umi, kitSigner)));
  return umi;
}

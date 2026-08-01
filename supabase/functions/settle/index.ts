// Sale settlement. Two actions, both authenticated:
//
//  prepare: verifies the listing against *on-chain* state (owner + transfer
//    delegate), then builds one atomic transaction — Core transfer
//    (seller → buyer, signed here by the settlement authority) + lamport
//    payment (buyer → seller) — and returns it partially signed. The buyer
//    signs and submits it from the browser.
//
//  confirm: verifies the confirmed signature against the RPC (success, seller
//    paid at least the price, asset now owned by the buyer) before marking the
//    listing sold. The client's word is never trusted.
import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import {
  createNoopSigner,
  createSignerFromKeypair,
  publicKey,
  signTransaction,
  transactionBuilder,
  type Umi,
} from "npm:@metaplex-foundation/umi@1.5.1";
import { createUmi } from "npm:@metaplex-foundation/umi-bundle-defaults@1.5.1";
import { base58, base64 } from "npm:@metaplex-foundation/umi@1.5.1/serializers";
import {
  fetchAsset,
  mplCore,
  removePlugin,
  transfer,
} from "npm:@metaplex-foundation/mpl-core@1.10.0";

const SYSTEM_PROGRAM = publicKey("11111111111111111111111111111111");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getUmi(): { umi: Umi; rpcUrl: string } {
  const rpcUrl = Deno.env.get("SOLANA_RPC_URL");
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL is not configured");
  return { umi: createUmi(rpcUrl).use(mplCore()), rpcUrl };
}

function getSettlementSigner(umi: Umi) {
  const secret = Deno.env.get("SETTLEMENT_AUTHORITY_SECRET");
  if (!secret) throw new Error("SETTLEMENT_AUTHORITY_SECRET is not configured");
  const keypair = umi.eddsa.createKeypairFromSecretKey(
    base58.serialize(secret)
  );
  return createSignerFromKeypair(umi, keypair);
}

// System program transfer instruction, encoded by hand: u32 LE discriminator
// (2 = Transfer) followed by u64 LE lamports.
function systemTransferData(lamports: bigint): Uint8Array {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return data;
}

type ListingRow = {
  id: string;
  status: string;
  price_lamports: number | string;
  seller_id: string;
  nft: {
    id: string;
    asset_address: string;
    collection: { collection_address: string | null } | null;
  };
  seller: { wallet_address: string | null };
};

async function loadListing(admin: ReturnType<typeof createClient>, listingId: string) {
  const { data, error } = await admin
    .from("listings")
    .select(
      "id, status, price_lamports, seller_id, nft:nfts(id, asset_address, collection:collections(collection_address)), seller:profiles!listings_seller_id_fkey(wallet_address)"
    )
    .eq("id", listingId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load listing: ${error.message}`);
  return data as ListingRow | null;
}

async function prepare(
  admin: ReturnType<typeof createClient>,
  userId: string,
  listingId: string
): Promise<Response> {
  const listing = await loadListing(admin, listingId);
  if (!listing) return json(404, { error: "Listing not found." });
  if (listing.status !== "active") {
    return json(409, { error: "This listing is no longer active." });
  }
  if (listing.seller_id === userId) {
    return json(400, { error: "You cannot buy your own listing." });
  }
  const sellerWallet = listing.seller?.wallet_address;
  if (!sellerWallet) return json(409, { error: "Seller has no wallet on file." });

  const { data: buyerProfile } = await admin
    .from("profiles")
    .select("wallet_address")
    .eq("id", userId)
    .maybeSingle();
  const buyerWallet = buyerProfile?.wallet_address;
  if (!buyerWallet) return json(409, { error: "Your profile has no wallet address." });

  const { umi } = getUmi();
  const settlementSigner = getSettlementSigner(umi);

  // Chain is the source of truth: the DB row is only a cache.
  let asset;
  try {
    asset = await fetchAsset(umi, listing.nft.asset_address);
  } catch {
    return json(409, { error: "Asset not found on chain." });
  }
  if (asset.owner !== publicKey(sellerWallet)) {
    // Seller moved the NFT out from under the listing — close it.
    await admin
      .from("listings")
      .update({ status: "cancelled" })
      .eq("id", listing.id)
      .eq("status", "active");
    return json(409, { error: "The seller no longer owns this NFT." });
  }
  const delegate = asset.transferDelegate?.authority;
  if (
    delegate?.type !== "Address" ||
    delegate.address !== settlementSigner.publicKey
  ) {
    return json(409, {
      error: "This listing is not delegated for settlement.",
    });
  }

  const price = BigInt(listing.price_lamports);
  const buyer = publicKey(buyerWallet);
  const buyerSigner = createNoopSigner(buyer);
  const collectionAddress = listing.nft.collection?.collection_address ?? null;

  const blockhash = await umi.rpc.getLatestBlockhash();
  const builder = transactionBuilder()
    .add(
      transfer(umi, {
        asset,
        ...(collectionAddress
          ? {
              collection: {
                publicKey: publicKey(collectionAddress),
                oracles: [],
                lifecycleHooks: [],
              },
            }
          : {}),
        newOwner: buyer,
        authority: settlementSigner,
        payer: buyerSigner,
      })
    )
    .add(
      // Core resets a TransferDelegate's authority to Owner the moment it's
      // used to move the asset (one-shot delegate) — so by this point in the
      // same transaction, the buyer (not the settlement signer) is already
      // the plugin's authority and is who must remove it.
      removePlugin(umi, {
        asset: publicKey(asset.publicKey),
        ...(collectionAddress
          ? { collection: publicKey(collectionAddress) }
          : {}),
        plugin: { type: "TransferDelegate" },
        authority: buyerSigner,
        payer: buyerSigner,
      })
    )
    .add({
      instruction: {
        programId: SYSTEM_PROGRAM,
        keys: [
          { pubkey: buyer, isSigner: true, isWritable: true },
          { pubkey: publicKey(sellerWallet), isSigner: false, isWritable: true },
        ],
        data: systemTransferData(price),
      },
      signers: [buyerSigner],
      bytesCreatedOnChain: 0,
    })
    .setFeePayer(buyerSigner)
    .setBlockhash(blockhash);

  const transaction = builder.build(umi);
  const signed = await signTransaction(transaction, [settlementSigner]);

  return json(200, {
    transaction: base64.deserialize(umi.transactions.serialize(signed))[0],
    blockhash: blockhash.blockhash,
    lastValidBlockHeight: String(blockhash.lastValidBlockHeight),
  });
}

// Public devnet RPC endpoints rate-limit aggressively; by the time confirm()
// calls this, the buyer's transaction has already landed on chain, so it's
// worth a short backoff-and-retry rather than failing a real sale over a
// transient 429.
async function rpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
  attempt = 1
): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  const isRateLimited =
    response.status === 429 ||
    (typeof body.error?.message === "string" &&
      body.error.message.toLowerCase().includes("rate limit"));
  if (isRateLimited && attempt < 5) {
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    return rpcCall(rpcUrl, method, params, attempt + 1);
  }
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function confirm(
  admin: ReturnType<typeof createClient>,
  userId: string,
  listingId: string,
  signature: string
): Promise<Response> {
  const listing = await loadListing(admin, listingId);
  if (!listing) return json(404, { error: "Listing not found." });
  if (listing.status === "sold") {
    return json(200, { ok: true, alreadyRecorded: true });
  }
  if (listing.status !== "active") {
    return json(409, { error: "This listing is no longer active." });
  }

  const { data: buyerProfile } = await admin
    .from("profiles")
    .select("wallet_address")
    .eq("id", userId)
    .maybeSingle();
  const buyerWallet = buyerProfile?.wallet_address;
  if (!buyerWallet) return json(409, { error: "Your profile has no wallet address." });

  const { rpcUrl } = getUmi();
  const price = BigInt(listing.price_lamports);
  const sellerWallet = listing.seller?.wallet_address;
  const assetAddress = listing.nft.asset_address;

  const tx = await rpcCall(rpcUrl, "getTransaction", [
    signature,
    {
      commitment: "confirmed",
      encoding: "json",
      maxSupportedTransactionVersion: 0,
    },
  ]);
  if (!tx) return json(409, { error: "Transaction not found or not confirmed yet." });
  if (tx.meta?.err) return json(409, { error: "Transaction failed on chain." });

  // Must be *this* sale: fee payer is the buyer's wallet, and it touches the
  // asset and the seller — not just any successful transaction signature.
  const accountKeys: string[] = tx.transaction.message.accountKeys;
  if (accountKeys[0] !== buyerWallet) {
    return json(409, { error: "Transaction was not paid by your wallet." });
  }
  if (!accountKeys.includes(assetAddress) || !sellerWallet || !accountKeys.includes(sellerWallet)) {
    return json(409, { error: "Transaction does not match this listing." });
  }

  const sellerIndex = accountKeys.indexOf(sellerWallet);
  const received =
    BigInt(tx.meta.postBalances[sellerIndex]) -
    BigInt(tx.meta.preBalances[sellerIndex]);
  if (received < price) {
    return json(409, { error: "Seller was not paid the listing price." });
  }

  // AssetV1 layout: byte 0 is the key discriminator, bytes 1-33 the owner pubkey.
  const account = await rpcCall(rpcUrl, "getAccountInfo", [
    assetAddress,
    { commitment: "confirmed", encoding: "base64" },
  ]);
  const data = account?.value?.data?.[0];
  if (!data) return json(409, { error: "Asset account not found." });
  const bytes = base64.serialize(data);
  const onChainOwner = base58.deserialize(bytes.slice(1, 33))[0];
  if (bytes[0] !== 1 || onChainOwner !== buyerWallet) {
    return json(409, { error: "Asset is not owned by your wallet." });
  }

  // All checks passed — record the sale. The status guard makes this a
  // single-winner update if two confirms race.
  const { data: updated, error: updateError } = await admin
    .from("listings")
    .update({ status: "sold", buyer_id: userId, sale_tx: signature })
    .eq("id", listing.id)
    .eq("status", "active")
    .select("id");
  if (updateError) return json(500, { error: updateError.message });
  if (!updated || updated.length === 0) {
    return json(409, { error: "Listing was already settled." });
  }

  await admin
    .from("nfts")
    .update({ owner_id: userId, owner_wallet: buyerWallet })
    .eq("id", listing.nft.id);
  await admin.from("activities").insert({
    type: "sale",
    nft_id: listing.nft.id,
    actor_id: userId,
    counterparty_id: listing.seller_id,
    lamports: price.toString(),
    tx_signature: signature,
  });

  return json(200, { ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json(401, { error: "Sign in to buy." });

    const admin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    if (body.action === "prepare" && typeof body.listingId === "string") {
      return await prepare(admin, user.id, body.listingId);
    }
    if (
      body.action === "confirm" &&
      typeof body.listingId === "string" &&
      typeof body.signature === "string"
    ) {
      return await confirm(admin, user.id, body.listingId, body.signature);
    }
    return json(400, { error: "Unknown action." });
  } catch (e) {
    console.error(e);
    return json(500, {
      error: e instanceof Error ? e.message : "Settlement failed.",
    });
  }
});

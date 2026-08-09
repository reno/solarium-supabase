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
import { feeOf } from "../_shared/fee.ts";
import { rpcCallForResult } from "../_shared/rpc.ts";
import { decodeBase64, isBase58, isUuid, messageBytesOf, sha256Hex } from "../_shared/tx.ts";

const SYSTEM_PROGRAM = publicKey("11111111111111111111111111111111");

// Request bodies here are a handful of ids and a signature; anything larger is not a client of
// ours. Bounded before parsing so a large body is never materialised.
const MAX_BODY_BYTES = 4096;

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

// Every message that reaches a client is written here, deliberately. Postgres error text names
// columns, constraints and policies; RPC errors name the provider endpoint (which carries an
// API key in this project). The detail goes to the log, the caller gets the sentence they can
// act on.
function fail(status: number, message: string, cause?: unknown): Response {
  if (cause !== undefined) console.error(`[settle] ${message}`, cause);
  return json(status, { error: message });
}

function getRpcUrl(): string {
  const rpcUrl = Deno.env.get("SOLANA_RPC_URL");
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL is not configured");
  return rpcUrl;
}

function getUmi(): { umi: Umi; rpcUrl: string } {
  const rpcUrl = getRpcUrl();
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

function systemTransferData(lamports: bigint): Uint8Array {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return data;
}

type Admin = ReturnType<typeof createClient>;

type SettleParams = {
  assetAddress: string;
  collectionAddress: string | null;
  sellerWallet: string;
  buyerWallet: string;
  price: bigint;
  creatorWallet?: string | null;
  royaltyLamports?: bigint;
  feeLamports?: bigint;
  staleListingId?: string;
};

type CollectionRoyalty = {
  collection_address: string | null;
  royalty_bps: number | null;
  creator: { wallet_address: string | null } | { wallet_address: string | null }[] | null;
} | null;

function royaltyOf(collection: CollectionRoyalty, price: bigint): {
  creatorWallet: string | null;
  royaltyLamports: bigint;
} {
  if (!collection) return { creatorWallet: null, royaltyLamports: 0n };
  const creator = Array.isArray(collection.creator) ? collection.creator[0] : collection.creator;
  const creatorWallet = creator?.wallet_address ?? null;
  const bps = BigInt(collection.royalty_bps ?? 0);
  const royaltyLamports = creatorWallet ? (price * bps) / 10000n : 0n;
  return { creatorWallet, royaltyLamports };
}

// The royalty leg is omitted when the collection creator is either side of the sale: as seller
// they would be paying themselves out of their own proceeds, and as buyer it is a self-transfer
// that could never be confirmed, since the creator is also the fee payer and their net balance
// only goes down.
//
// This used to need a mirror-image predicate in the verifier, and the two had to be kept in
// step by hand or a transaction built without a royalty leg would fail a verifier still
// expecting one. Verification is now a hash of the built message, so this predicate is the only
// place the rule exists — there is nothing left to keep in sync.
function splitApplies(p: SettleParams): boolean {
  return (
    (p.royaltyLamports ?? 0n) > 0n &&
    !!p.creatorWallet &&
    p.creatorWallet !== p.sellerWallet &&
    p.creatorWallet !== p.buyerWallet
  );
}

type BuiltSettlement = {
  payload: { transaction: string; blockhash: string; lastValidBlockHeight: string };
  messageHash: string;
};

async function buildSettlement(
  admin: Admin,
  p: SettleParams
): Promise<{ ok: true; built: BuiltSettlement } | { ok: false; response: Response }> {
  const { umi } = getUmi();
  const settlementSigner = getSettlementSigner(umi);

  let asset;
  try {
    asset = await fetchAsset(umi, p.assetAddress);
  } catch {
    return { ok: false, response: json(409, { error: "Asset not found on chain." }) };
  }
  if (asset.owner !== publicKey(p.sellerWallet)) {
    // The seller transferred the item out from under the listing. Cancelling is a statement of
    // objective on-chain fact rather than an authorization decision, which is why it is safe to
    // do here on a row the caller does not own: listings are a cache, and this one is provably
    // stale.
    if (p.staleListingId) {
      await admin
        .from("listings")
        .update({ status: "cancelled" })
        .eq("id", p.staleListingId)
        .eq("status", "active");
    }
    return { ok: false, response: json(409, { error: "The seller no longer owns this NFT." }) };
  }
  const delegate = asset.transferDelegate?.authority;
  if (delegate?.type !== "Address" || delegate.address !== settlementSigner.publicKey) {
    return { ok: false, response: json(409, { error: "This item is not delegated for settlement." }) };
  }

  const buyer = publicKey(p.buyerWallet);
  const buyerSigner = createNoopSigner(buyer);
  const collectionAddress = p.collectionAddress;

  const blockhash = await umi.rpc.getLatestBlockhash();
  let builder = transactionBuilder()
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
      removePlugin(umi, {
        asset: publicKey(asset.publicKey),
        ...(collectionAddress ? { collection: publicKey(collectionAddress) } : {}),
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
          { pubkey: publicKey(p.sellerWallet), isSigner: false, isWritable: true },
        ],
        data: systemTransferData(p.price),
      },
      signers: [buyerSigner],
      bytesCreatedOnChain: 0,
    });
  if (splitApplies(p)) {
    builder = builder.add({
      instruction: {
        programId: SYSTEM_PROGRAM,
        keys: [
          { pubkey: buyer, isSigner: true, isWritable: true },
          { pubkey: publicKey(p.creatorWallet!), isSigner: false, isWritable: true },
        ],
        data: systemTransferData(p.royaltyLamports ?? 0n),
      },
      signers: [buyerSigner],
      bytesCreatedOnChain: 0,
    });
  }
  const fee = p.feeLamports ?? 0n;
  if (fee > 0n) {
    builder = builder.add({
      instruction: {
        programId: SYSTEM_PROGRAM,
        keys: [
          { pubkey: buyer, isSigner: true, isWritable: true },
          { pubkey: settlementSigner.publicKey, isSigner: false, isWritable: true },
        ],
        data: systemTransferData(fee),
      },
      signers: [buyerSigner],
      bytesCreatedOnChain: 0,
    });
  }
  builder = builder.setFeePayer(buyerSigner).setBlockhash(blockhash);

  const transaction = builder.build(umi);
  const signed = await signTransaction(transaction, [settlementSigner]);

  return {
    ok: true,
    built: {
      payload: {
        transaction: base64.deserialize(umi.transactions.serialize(signed))[0],
        blockhash: blockhash.blockhash,
        lastValidBlockHeight: String(blockhash.lastValidBlockHeight),
      },
      // Hash the message, not the signed transaction: signatures are appended around a message
      // that does not change, so this is stable from the moment we build it to the moment the
      // buyer's copy lands on chain.
      messageHash: await sha256Hex(transaction.serializedMessage),
    },
  };
}

type IntentRow = {
  id: string;
  listing_id: string | null;
  offer_id: string | null;
  buyer_id: string;
  nft_id: string;
  consumed_at: string | null;
  consumed_tx: string | null;
};

/**
 * Verify a confirmed signature and record the sale.
 *
 * The whole check is: fetch the transaction, hash its message, and find the settlement intent
 * we issued with that hash. A match means every instruction, account, ordering and lamport
 * amount is byte-identical to what this marketplace built and signed — the price, the fee, the
 * royalty leg and its carve-out, and the Core transfer of this specific asset to this specific
 * buyer. There is nothing left for a hand-built transaction to satisfy.
 *
 * What the old check did instead was ask whether the account key list *mentioned* the asset and
 * the seller, and whether balances moved by at least the right amounts. Both are properties an
 * attacker can arrange with an unrelated payment, which is what made wash trading cheap and
 * made one signature able to settle ten different listings.
 *
 * Two things follow from binding this way. Address lookup tables stop mattering: the old code
 * read message.accountKeys, which omits ALT-loaded addresses, so a buyer whose wallet
 * compressed the transaction was told their purchase did not match — after paying. And the
 * separate "is the buyer the owner now" call is gone: the message proves the transfer is in
 * the transaction and meta.err proves it executed, so re-reading current ownership could only
 * add a false negative for a buyer who moved the asset on again before we recorded it.
 */
async function confirmSettlement(
  admin: Admin,
  userId: string,
  target: { listingId: string } | { offerId: string },
  signature: string
): Promise<Response> {
  const rpcUrl = getRpcUrl();

  // Confirmed rather than finalized, deliberately: the client has already waited for
  // confirmation via the blockhash strategy, and demanding finalization would show every buyer
  // a failure for the ~13s until it lands. The residual risk is a confirmed transaction dropped
  // on a fork, which would leave a sale recorded that never settled. Closing that properly is a
  // reconciliation sweep over recent sales, not a stricter commitment here.
  const tx = await rpcCallForResult(rpcUrl, "getTransaction", [
    signature,
    { commitment: "confirmed", encoding: "base64", maxSupportedTransactionVersion: 0 },
  ]);
  if (!tx) return json(409, { error: "Transaction not found or not confirmed yet." });
  if (tx.meta?.err) return json(409, { error: "Transaction failed on chain." });

  const encoded = tx.transaction?.[0];
  if (typeof encoded !== "string") {
    return fail(502, "Could not read the transaction from the network.", tx.transaction);
  }

  let messageHash: string;
  try {
    messageHash = await sha256Hex(messageBytesOf(decodeBase64(encoded)));
  } catch (e) {
    return fail(409, "Transaction could not be parsed.", e);
  }

  const { data: intentRow, error: intentError } = await admin
    .from("settlement_intents")
    .select("id, listing_id, offer_id, buyer_id, nft_id, consumed_at, consumed_tx")
    .eq("message_hash", messageHash)
    .maybeSingle();
  if (intentError) return fail(500, "Could not verify this settlement.", intentError);

  const intent = intentRow as IntentRow | null;
  if (!intent) {
    return json(409, {
      error: "That transaction was not issued for this purchase. Start the purchase again.",
    });
  }
  if (intent.buyer_id !== userId) {
    return json(403, { error: "That settlement belongs to a different buyer." });
  }
  const matchesTarget =
    "listingId" in target ? intent.listing_id === target.listingId : intent.offer_id === target.offerId;
  if (!matchesTarget) {
    return json(409, { error: "That transaction was issued for a different sale." });
  }

  const { data: recorded, error: recordError } = await admin.rpc("record_settled_sale", {
    p_intent_id: intent.id,
    p_signature: signature,
  });
  if (recordError) {
    // The function raises when the listing or offer moved on under it; everything else is a
    // genuine fault. Either way the caller gets one sentence and the detail goes to the log.
    return fail(409, "This sale could not be recorded — it may already have been settled.", recordError);
  }
  if (recorded === false) {
    // Someone already consumed this intent. If it was the same signature, this is the client
    // retrying and the correct answer is success.
    const { data: after } = await admin
      .from("settlement_intents")
      .select("consumed_tx")
      .eq("id", intent.id)
      .maybeSingle();
    if ((after as { consumed_tx: string | null } | null)?.consumed_tx === signature) {
      return json(200, { ok: true, alreadyRecorded: true });
    }
    return json(409, { error: "This settlement was already used." });
  }

  return json(200, { ok: true });
}

async function walletOf(admin: Admin, userId: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("wallet_address").eq("id", userId).maybeSingle();
  return data?.wallet_address ?? null;
}

type ListingRow = {
  id: string;
  status: string;
  price_lamports: number | string;
  seller_id: string;
  nft: { id: string; asset_address: string; collection_id: string | null; collection: CollectionRoyalty };
  seller: { wallet_address: string | null };
};

async function loadListing(admin: Admin, listingId: string): Promise<ListingRow | null> {
  const { data, error } = await admin
    .from("listings")
    .select(
      "id, status, price_lamports, seller_id, nft:nfts(id, asset_address, collection_id, collection:collections(collection_address, royalty_bps, creator:profiles!collections_creator_id_fkey(wallet_address))), seller:profiles!listings_seller_id_fkey(wallet_address)"
    )
    .eq("id", listingId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load listing ${listingId}: ${error.message}`);
  return data as ListingRow | null;
}

/** Lamport columns arrive as strings from PostgREST; a malformed one must not become a 500. */
function toLamports(value: number | string): bigint | null {
  try {
    const n = BigInt(value);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

async function prepare(admin: Admin, userId: string, listingId: string): Promise<Response> {
  const listing = await loadListing(admin, listingId);
  if (!listing) return json(404, { error: "Listing not found." });
  if (listing.status !== "active") return json(409, { error: "This listing is no longer active." });
  if (listing.seller_id === userId) return json(400, { error: "You cannot buy your own listing." });
  const sellerWallet = listing.seller?.wallet_address;
  if (!sellerWallet) return json(409, { error: "Seller has no wallet on file." });
  const buyerWallet = await walletOf(admin, userId);
  if (!buyerWallet) return json(409, { error: "Your profile has no wallet address." });

  const price = toLamports(listing.price_lamports);
  if (price === null) return fail(409, "This listing has an invalid price.", listing.price_lamports);
  const { creatorWallet, royaltyLamports } = royaltyOf(listing.nft.collection, price);
  const feeLamports = feeOf(price);
  const params: SettleParams = {
    assetAddress: listing.nft.asset_address,
    collectionAddress: listing.nft.collection?.collection_address ?? null,
    sellerWallet,
    buyerWallet,
    price,
    creatorWallet,
    royaltyLamports,
    feeLamports,
    staleListingId: listing.id,
  };

  const result = await buildSettlement(admin, params);
  if (!result.ok) return result.response;

  // The quote is recorded before it is handed out. confirm settles at these numbers, so a
  // seller who reprices during the confirm window can no longer make a paid purchase
  // unrecordable.
  const { error } = await admin.from("settlement_intents").insert({
    message_hash: result.built.messageHash,
    listing_id: listing.id,
    buyer_id: userId,
    nft_id: listing.nft.id,
    seller_id: listing.seller_id,
    price_lamports: price.toString(),
    fee_lamports: feeLamports.toString(),
    royalty_lamports: (splitApplies(params) ? royaltyLamports : 0n).toString(),
    buyer_wallet: buyerWallet,
    asset_address: listing.nft.asset_address,
  });
  // A duplicate hash means an identical quote is already outstanding — same listing, same
  // buyer, same blockhash. The transaction we just built is the one it recorded, so handing it
  // back is correct.
  if (error && error.code !== "23505") {
    return fail(500, "Could not start this purchase.", error);
  }

  return json(200, result.built.payload);
}

type OfferRow = {
  id: string;
  status: string;
  price_lamports: number | string;
  bidder_id: string;
  collection_id: string | null;
  nft: {
    id: string;
    asset_address: string;
    owner_id: string | null;
    collection_id: string | null;
    collection: CollectionRoyalty;
  } | null;
  bidder: { wallet_address: string | null };
};

async function loadOffer(admin: Admin, offerId: string): Promise<OfferRow | null> {
  const { data, error } = await admin
    .from("offers")
    .select(
      "id, status, price_lamports, bidder_id, collection_id, nft:nfts(id, asset_address, owner_id, collection_id, collection:collections(collection_address, royalty_bps, creator:profiles!collections_creator_id_fkey(wallet_address))), bidder:profiles!offers_bidder_id_fkey(wallet_address)"
    )
    .eq("id", offerId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load offer ${offerId}: ${error.message}`);
  return data as OfferRow | null;
}

async function activeListingFor(admin: Admin, nftId: string) {
  const { data } = await admin
    .from("listings")
    .select("id, seller_id, seller:profiles!listings_seller_id_fkey(wallet_address)")
    .eq("nft_id", nftId)
    .eq("status", "active")
    .maybeSingle();
  return data as { id: string; seller_id: string; seller: { wallet_address: string | null } } | null;
}

async function acceptOffer(admin: Admin, userId: string, offerId: string, nftId?: string): Promise<Response> {
  const offer = await loadOffer(admin, offerId);
  if (!offer) return json(404, { error: "Offer not found." });
  if (offer.status !== "active") return json(409, { error: "This offer is no longer active." });

  let nftIdToSettle: string;
  if (offer.nft) {
    if (offer.nft.owner_id !== userId) return json(403, { error: "Only the current owner can accept offers." });
    nftIdToSettle = offer.nft.id;
  } else {
    if (!nftId) return json(400, { error: "Pick which item to sell to accept a collection offer." });
    const { data: nft, error: nftErr } = await admin
      .from("nfts")
      .select("id, owner_id, collection_id")
      .eq("id", nftId)
      .maybeSingle();
    if (nftErr) return fail(500, "Could not load that item.", nftErr);
    if (!nft) return json(404, { error: "Item not found." });
    if (nft.owner_id !== userId) return json(403, { error: "Only the current owner can accept offers." });
    if (nft.collection_id !== offer.collection_id) return json(409, { error: "That item isn't in this collection." });
    nftIdToSettle = nft.id as string;
  }

  const listing = await activeListingFor(admin, nftIdToSettle);
  if (!listing) {
    return json(409, { error: "List this item before accepting offers (offers settle through the listing)." });
  }

  const { data: updated, error } = await admin
    .from("offers")
    .update({ status: "accepted", nft_id: nftIdToSettle })
    .eq("id", offer.id)
    .eq("status", "active")
    .select("id");
  if (error) return fail(500, "Could not accept this offer.", error);
  if (!updated || updated.length === 0) return json(409, { error: "Offer was already handled." });
  return json(200, { ok: true });
}

/** Everything prepareOffer and confirmOffer both need, with the shared authorization applied. */
async function loadAcceptedOffer(
  admin: Admin,
  userId: string,
  offerId: string
): Promise<
  | { ok: false; response: Response }
  | {
      ok: true;
      offer: OfferRow & { nft: NonNullable<OfferRow["nft"]> };
      listing: { id: string; seller_id: string; seller: { wallet_address: string | null } };
      sellerWallet: string;
      buyerWallet: string;
      price: bigint;
    }
> {
  const offer = await loadOffer(admin, offerId);
  if (!offer) return { ok: false, response: json(404, { error: "Offer not found." }) };
  if (offer.status !== "accepted") {
    return { ok: false, response: json(409, { error: "This offer has not been accepted." }) };
  }
  if (offer.bidder_id !== userId) {
    return { ok: false, response: json(403, { error: "Only the bidder can complete this offer." }) };
  }
  if (!offer.nft) {
    return { ok: false, response: json(409, { error: "This offer isn't bound to an item yet." }) };
  }
  const listing = await activeListingFor(admin, offer.nft.id);
  if (!listing) return { ok: false, response: json(409, { error: "The item is no longer listed." }) };
  const sellerWallet = listing.seller?.wallet_address;
  if (!sellerWallet) return { ok: false, response: json(409, { error: "Seller has no wallet on file." }) };
  if (listing.seller_id === userId) {
    return { ok: false, response: json(400, { error: "You cannot buy your own listing." }) };
  }
  const buyerWallet = offer.bidder?.wallet_address ?? (await walletOf(admin, userId));
  if (!buyerWallet) return { ok: false, response: json(409, { error: "Your profile has no wallet address." }) };
  const price = toLamports(offer.price_lamports);
  if (price === null) {
    return { ok: false, response: fail(409, "This offer has an invalid price.", offer.price_lamports) };
  }
  return {
    ok: true,
    offer: offer as OfferRow & { nft: NonNullable<OfferRow["nft"]> },
    listing,
    sellerWallet,
    buyerWallet,
    price,
  };
}

async function prepareOffer(admin: Admin, userId: string, offerId: string): Promise<Response> {
  const loaded = await loadAcceptedOffer(admin, userId, offerId);
  if (!loaded.ok) return loaded.response;
  const { offer, listing, sellerWallet, buyerWallet, price } = loaded;

  const { creatorWallet, royaltyLamports } = royaltyOf(offer.nft.collection, price);
  const feeLamports = feeOf(price);
  const params: SettleParams = {
    assetAddress: offer.nft.asset_address,
    collectionAddress: offer.nft.collection?.collection_address ?? null,
    sellerWallet,
    buyerWallet,
    price,
    creatorWallet,
    royaltyLamports,
    feeLamports,
    staleListingId: listing.id,
  };

  const result = await buildSettlement(admin, params);
  if (!result.ok) return result.response;

  const { error } = await admin.from("settlement_intents").insert({
    message_hash: result.built.messageHash,
    offer_id: offer.id,
    buyer_id: userId,
    nft_id: offer.nft.id,
    seller_id: listing.seller_id,
    price_lamports: price.toString(),
    fee_lamports: feeLamports.toString(),
    royalty_lamports: (splitApplies(params) ? royaltyLamports : 0n).toString(),
    buyer_wallet: buyerWallet,
    asset_address: offer.nft.asset_address,
  });
  if (error && error.code !== "23505") {
    return fail(500, "Could not start this settlement.", error);
  }

  return json(200, result.built.payload);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) return json(413, { error: "Request body too large." });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json(401, { error: "Sign in to continue." });

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: "Request body too large." });
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json(400, { error: "Malformed request." });
    }

    // Shape checks are format checks, not just type tags: an id that is not a uuid and a
    // signature that is not base58 have no business reaching the database or the RPC provider.
    const { action, listingId, offerId, nftId, signature } = body;

    if (action === "prepare" && isUuid(listingId)) {
      return await prepare(admin, user.id, listingId);
    }
    if (action === "confirm" && isUuid(listingId) && isBase58(signature)) {
      return await confirmSettlement(admin, user.id, { listingId }, signature);
    }
    if (action === "acceptOffer" && isUuid(offerId)) {
      return await acceptOffer(admin, user.id, offerId, isUuid(nftId) ? nftId : undefined);
    }
    if (action === "prepareOffer" && isUuid(offerId)) {
      return await prepareOffer(admin, user.id, offerId);
    }
    if (action === "confirmOffer" && isUuid(offerId) && isBase58(signature)) {
      return await confirmSettlement(admin, user.id, { offerId }, signature);
    }
    return json(400, { error: "Unknown or malformed action." });
  } catch (e) {
    console.error("[settle] unhandled", e);
    return json(500, { error: "Settlement failed. Please try again." });
  }
});

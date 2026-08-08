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
import { rpcCall } from "../_shared/rpc.ts";

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

// Must mirror `doRoyalty` in the verify path below: a transaction built without a royalty
// leg fails a verifier that still expects one.
function splitApplies(p: SettleParams): boolean {
  return (
    (p.royaltyLamports ?? 0n) > 0n &&
    !!p.creatorWallet &&
    p.creatorWallet !== p.sellerWallet &&
    p.creatorWallet !== p.buyerWallet
  );
}

async function buildSettlementResponse(admin: Admin, p: SettleParams): Promise<Response> {
  const { umi } = getUmi();
  const settlementSigner = getSettlementSigner(umi);

  let asset;
  try {
    asset = await fetchAsset(umi, p.assetAddress);
  } catch {
    return json(409, { error: "Asset not found on chain." });
  }
  if (asset.owner !== publicKey(p.sellerWallet)) {
    if (p.staleListingId) {
      await admin
        .from("listings")
        .update({ status: "cancelled" })
        .eq("id", p.staleListingId)
        .eq("status", "active");
    }
    return json(409, { error: "The seller no longer owns this NFT." });
  }
  const delegate = asset.transferDelegate?.authority;
  if (delegate?.type !== "Address" || delegate.address !== settlementSigner.publicKey) {
    return json(409, { error: "This item is not delegated for settlement." });
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

  return json(200, {
    transaction: base64.deserialize(umi.transactions.serialize(signed))[0],
    blockhash: blockhash.blockhash,
    lastValidBlockHeight: String(blockhash.lastValidBlockHeight),
  });
}

async function verifySettlement(
  rpcUrl: string,
  args: {
    signature: string;
    buyerWallet: string;
    sellerWallet: string;
    assetAddress: string;
    price: bigint;
    creatorWallet?: string | null;
    royaltyLamports?: bigint;
    treasuryWallet?: string | null;
    feeLamports?: bigint;
  }
): Promise<Response | null> {
  const tx = await rpcCall(rpcUrl, "getTransaction", [
    args.signature,
    { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 0 },
  ]);
  if (!tx) return json(409, { error: "Transaction not found or not confirmed yet." });
  if (tx.meta?.err) return json(409, { error: "Transaction failed on chain." });

  const accountKeys: string[] = tx.transaction.message.accountKeys;
  if (accountKeys[0] !== args.buyerWallet) {
    return json(409, { error: "Transaction was not paid by your wallet." });
  }
  if (!accountKeys.includes(args.assetAddress) || !accountKeys.includes(args.sellerWallet)) {
    return json(409, { error: "Transaction does not match this sale." });
  }

  const royalty = args.royaltyLamports ?? 0n;
  // Must mirror `splitApplies` in the build path above.
  const doRoyalty =
    royalty > 0n &&
    !!args.creatorWallet &&
    args.creatorWallet !== args.sellerWallet &&
    args.creatorWallet !== args.buyerWallet;

  const delta = (wallet: string): bigint => {
    const i = accountKeys.indexOf(wallet);
    return i < 0 ? -1n : BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]);
  };

  if (delta(args.sellerWallet) < args.price) {
    return json(409, { error: "Seller was not paid the agreed price." });
  }
  if (doRoyalty) {
    if (!accountKeys.includes(args.creatorWallet!) || delta(args.creatorWallet!) < royalty) {
      return json(409, { error: "Royalty was not paid to the creator." });
    }
  }
  const fee = args.feeLamports ?? 0n;
  if (fee > 0n && args.treasuryWallet) {
    if (!accountKeys.includes(args.treasuryWallet) || delta(args.treasuryWallet) < fee) {
      return json(409, { error: "Marketplace fee was not paid." });
    }
  }

  const account = await rpcCall(rpcUrl, "getAccountInfo", [
    args.assetAddress,
    { commitment: "confirmed", encoding: "base64" },
  ]);
  const data = account?.value?.data?.[0];
  if (!data) return json(409, { error: "Asset account not found." });
  const bytes = base64.serialize(data);
  const onChainOwner = base58.deserialize(bytes.slice(1, 33))[0];
  if (bytes[0] !== 1 || onChainOwner !== args.buyerWallet) {
    return json(409, { error: "Asset is not owned by your wallet." });
  }
  return null;
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

async function loadListing(admin: Admin, listingId: string) {
  const { data, error } = await admin
    .from("listings")
    .select(
      "id, status, price_lamports, seller_id, nft:nfts(id, asset_address, collection_id, collection:collections(collection_address, royalty_bps, creator:profiles!collections_creator_id_fkey(wallet_address))), seller:profiles!listings_seller_id_fkey(wallet_address)"
    )
    .eq("id", listingId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load listing: ${error.message}`);
  return data as ListingRow | null;
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

  const price = BigInt(listing.price_lamports);
  const { creatorWallet, royaltyLamports } = royaltyOf(listing.nft.collection, price);
  return await buildSettlementResponse(admin, {
    assetAddress: listing.nft.asset_address,
    collectionAddress: listing.nft.collection?.collection_address ?? null,
    sellerWallet,
    buyerWallet,
    price,
    creatorWallet,
    royaltyLamports,
    feeLamports: feeOf(price),
    staleListingId: listing.id,
  });
}

async function confirm(admin: Admin, userId: string, listingId: string, signature: string): Promise<Response> {
  const listing = await loadListing(admin, listingId);
  if (!listing) return json(404, { error: "Listing not found." });
  if (listing.status === "sold") return json(200, { ok: true, alreadyRecorded: true });
  if (listing.status !== "active") return json(409, { error: "This listing is no longer active." });

  const buyerWallet = await walletOf(admin, userId);
  if (!buyerWallet) return json(409, { error: "Your profile has no wallet address." });
  const sellerWallet = listing.seller?.wallet_address;
  if (!sellerWallet) return json(409, { error: "Seller has no wallet on file." });

  const { umi, rpcUrl } = getUmi();
  const treasuryWallet = getSettlementSigner(umi).publicKey;
  const price = BigInt(listing.price_lamports);
  const { creatorWallet, royaltyLamports } = royaltyOf(listing.nft.collection, price);
  const bad = await verifySettlement(rpcUrl, {
    signature,
    buyerWallet,
    sellerWallet,
    assetAddress: listing.nft.asset_address,
    price,
    creatorWallet,
    royaltyLamports,
    feeLamports: feeOf(price),
    treasuryWallet,
  });
  if (bad) return bad;

  const { data: updated, error: updateError } = await admin
    .from("listings")
    .update({ status: "sold", buyer_id: userId, sale_tx: signature })
    .eq("id", listing.id)
    .eq("status", "active")
    .select("id");
  if (updateError) return json(500, { error: updateError.message });
  if (!updated || updated.length === 0) return json(409, { error: "Listing was already settled." });

  await admin.from("nfts").update({ owner_id: userId, owner_wallet: buyerWallet }).eq("id", listing.nft.id);
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

async function loadOffer(admin: Admin, offerId: string) {
  const { data, error } = await admin
    .from("offers")
    .select(
      "id, status, price_lamports, bidder_id, collection_id, nft:nfts(id, asset_address, owner_id, collection_id, collection:collections(collection_address, royalty_bps, creator:profiles!collections_creator_id_fkey(wallet_address))), bidder:profiles!offers_bidder_id_fkey(wallet_address)"
    )
    .eq("id", offerId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load offer: ${error.message}`);
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
    if (nftErr) return json(500, { error: nftErr.message });
    if (!nft) return json(404, { error: "Item not found." });
    if (nft.owner_id !== userId) return json(403, { error: "Only the current owner can accept offers." });
    if (nft.collection_id !== offer.collection_id) return json(409, { error: "That item isn't in this collection." });
    nftIdToSettle = nft.id;
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
  if (error) return json(500, { error: error.message });
  if (!updated || updated.length === 0) return json(409, { error: "Offer was already handled." });
  return json(200, { ok: true });
}

async function prepareOffer(admin: Admin, userId: string, offerId: string): Promise<Response> {
  const offer = await loadOffer(admin, offerId);
  if (!offer) return json(404, { error: "Offer not found." });
  if (offer.status !== "accepted") return json(409, { error: "This offer has not been accepted." });
  if (offer.bidder_id !== userId) return json(403, { error: "Only the bidder can complete this offer." });
  if (!offer.nft) return json(409, { error: "This offer isn't bound to an item yet." });
  const listing = await activeListingFor(admin, offer.nft.id);
  if (!listing) return json(409, { error: "The item is no longer listed." });
  const sellerWallet = listing.seller?.wallet_address;
  if (!sellerWallet) return json(409, { error: "Seller has no wallet on file." });
  const buyerWallet = offer.bidder?.wallet_address ?? (await walletOf(admin, userId));
  if (!buyerWallet) return json(409, { error: "Your profile has no wallet address." });

  const price = BigInt(offer.price_lamports);
  const { creatorWallet, royaltyLamports } = royaltyOf(offer.nft.collection, price);
  return await buildSettlementResponse(admin, {
    assetAddress: offer.nft.asset_address,
    collectionAddress: offer.nft.collection?.collection_address ?? null,
    sellerWallet,
    buyerWallet,
    price,
    creatorWallet,
    royaltyLamports,
    feeLamports: feeOf(price),
    staleListingId: listing.id,
  });
}

async function confirmOffer(admin: Admin, userId: string, offerId: string, signature: string): Promise<Response> {
  const offer = await loadOffer(admin, offerId);
  if (!offer) return json(404, { error: "Offer not found." });
  if (offer.status !== "accepted") return json(409, { error: "This offer has not been accepted." });
  if (offer.bidder_id !== userId) return json(403, { error: "Only the bidder can complete this offer." });
  if (!offer.nft) return json(409, { error: "This offer isn't bound to an item yet." });
  const listing = await activeListingFor(admin, offer.nft.id);
  if (!listing) return json(409, { error: "The item is no longer listed." });
  const sellerWallet = listing.seller?.wallet_address;
  if (!sellerWallet) return json(409, { error: "Seller has no wallet on file." });
  const buyerWallet = offer.bidder?.wallet_address ?? (await walletOf(admin, userId));
  if (!buyerWallet) return json(409, { error: "Your profile has no wallet address." });

  const { umi, rpcUrl } = getUmi();
  const treasuryWallet = getSettlementSigner(umi).publicKey;
  const price = BigInt(offer.price_lamports);
  const { creatorWallet, royaltyLamports } = royaltyOf(offer.nft.collection, price);
  const bad = await verifySettlement(rpcUrl, {
    signature,
    buyerWallet,
    sellerWallet,
    assetAddress: offer.nft.asset_address,
    price,
    creatorWallet,
    royaltyLamports,
    feeLamports: feeOf(price),
    treasuryWallet,
  });
  if (bad) return bad;

  const { data: updated, error: updateError } = await admin
    .from("offers")
    .update({ status: "accepted", accepted_tx: signature })
    .eq("id", offer.id)
    .eq("status", "accepted")
    .is("accepted_tx", null)
    .select("id");
  if (updateError) return json(500, { error: updateError.message });
  if (!updated || updated.length === 0) return json(200, { ok: true, alreadyRecorded: true });

  await admin
    .from("listings")
    .update({ status: "sold", buyer_id: userId, sale_tx: signature })
    .eq("id", listing.id)
    .eq("status", "active");
  await admin.from("nfts").update({ owner_id: userId, owner_wallet: buyerWallet }).eq("id", offer.nft.id);
  await admin.from("activities").insert({
    type: "sale",
    nft_id: offer.nft.id,
    actor_id: userId,
    counterparty_id: listing.seller_id,
    lamports: price.toString(),
    tx_signature: signature,
  });
  return json(200, { ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json(401, { error: "Sign in to continue." });

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();

    if (body.action === "prepare" && typeof body.listingId === "string") {
      return await prepare(admin, user.id, body.listingId);
    }
    if (body.action === "confirm" && typeof body.listingId === "string" && typeof body.signature === "string") {
      return await confirm(admin, user.id, body.listingId, body.signature);
    }
    if (body.action === "acceptOffer" && typeof body.offerId === "string") {
      return await acceptOffer(admin, user.id, body.offerId, typeof body.nftId === "string" ? body.nftId : undefined);
    }
    if (body.action === "prepareOffer" && typeof body.offerId === "string") {
      return await prepareOffer(admin, user.id, body.offerId);
    }
    if (body.action === "confirmOffer" && typeof body.offerId === "string" && typeof body.signature === "string") {
      return await confirmOffer(admin, user.id, body.offerId, body.signature);
    }
    return json(400, { error: "Unknown action." });
  } catch (e) {
    console.error(e);
    return json(500, { error: e instanceof Error ? e.message : "Settlement failed." });
  }
});

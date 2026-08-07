// Candy-machine mint recording.
//
// The buyer's own wallet calls the candy machine's `mintV1`, so unlike a listing purchase there
// is nothing for the server to build or co-sign — the chain has already enforced the price, the
// phase window, the per-wallet limit and the allowlist. What is left is recording it, and that
// cannot happen client-side: `nfts` only accepts an insert where `auth.uid() = creator_id`, and
// on a candy-machine drop the minter is not the creator. So this function holds the service role.
//
// Holding the service role means it must not believe the client. It re-derives every recorded
// field from the chain — the same rule the `settle` function follows:
//
//   • the signature really landed, succeeded, and was paid for by the caller's wallet
//   • the asset account exists and is *now owned by the caller*
//   • the asset belongs to this collection (Core update authority = the drop's collection)
//   • the name and metadata URI come from the asset account, not the request body
//
// The only client input that survives verification is which collection is being minted and the
// signature to check. Idempotency comes from `candy_machine_mints.signature` being unique: a
// replayed confirm finds the row and returns the original result instead of double-recording.
//
// Action (authenticated):
//   record — { collectionId, assetAddress, signature }
import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import { base58, base64 } from "npm:@metaplex-foundation/umi@1.5.1/serializers";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Admin = ReturnType<typeof createClient>;

// Public devnet RPC endpoints rate-limit aggressively, and by the time this runs the mint has
// already landed — worth a short backoff rather than failing a real mint over a transient 429.
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

type OnChainAsset = {
  owner: string;
  collection: string | null;
  name: string;
  uri: string;
};

/**
 * Decode the parts of a Core AssetV1 account this function records.
 *
 * Layout, in order: a 1-byte key discriminator (1 = AssetV1), the 32-byte owner, then the update
 * authority as a 1-byte enum tag (0 = None, 1 = Address, 2 = Collection) followed by a 32-byte
 * pubkey for tags 1 and 2, then two Borsh strings — name, then uri — each a u32 LE length
 * followed by its UTF-8 bytes. `settle` decodes the first two fields the same way; this goes
 * further because the recorded row needs the name, the URI and the collection membership.
 */
function decodeAsset(bytes: Uint8Array): OnChainAsset | null {
  if (bytes.length < 34 || bytes[0] !== 1) return null;
  const owner = base58.deserialize(bytes.slice(1, 33))[0];

  let offset = 33;
  const authorityTag = bytes[offset];
  offset += 1;
  let collection: string | null = null;
  if (authorityTag === 1 || authorityTag === 2) {
    const authority = base58.deserialize(bytes.slice(offset, offset + 32))[0];
    // Only a Collection authority (2) means "this asset is part of that collection". An Address
    // authority is just an updater and says nothing about membership.
    if (authorityTag === 2) collection = authority;
    offset += 32;
  } else if (authorityTag !== 0) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readString = (): string | null => {
    if (offset + 4 > bytes.length) return null;
    const length = view.getUint32(offset, true);
    offset += 4;
    if (length > 1024 || offset + length > bytes.length) return null;
    const value = new TextDecoder().decode(bytes.slice(offset, offset + length));
    offset += length;
    return value;
  };
  const name = readString();
  const uri = readString();
  if (name === null || uri === null) return null;

  return { owner, collection, name, uri };
}

/**
 * Verify the landed mint and read back what actually got minted.
 *
 * Returns the on-chain asset on success, or the HTTP error to send back. Note what is *not*
 * checked here: how much the minter paid. The guards decide that on chain — a transaction that
 * underpaid never lands, so re-deriving a price from balance deltas would only re-litigate a
 * decision the chain already made (and would be wrong for a free phase, or one where the minter
 * also happens to be the creator).
 */
async function verifyMint(
  rpcUrl: string,
  args: {
    signature: string;
    minterWallet: string;
    assetAddress: string;
    candyMachine: string;
    collectionAddress: string;
  }
): Promise<{ asset: OnChainAsset } | { error: Response }> {
  const tx = await rpcCall(rpcUrl, "getTransaction", [
    args.signature,
    { commitment: "confirmed", encoding: "json", maxSupportedTransactionVersion: 0 },
  ]);
  if (!tx) return { error: json(409, { error: "Transaction not found or not confirmed yet." }) };
  if (tx.meta?.err) return { error: json(409, { error: "Transaction failed on chain." }) };

  const accountKeys: string[] = tx.transaction.message.accountKeys;
  if (accountKeys[0] !== args.minterWallet) {
    return { error: json(409, { error: "Transaction was not paid by your wallet." }) };
  }
  if (!accountKeys.includes(args.candyMachine) || !accountKeys.includes(args.assetAddress)) {
    return { error: json(409, { error: "Transaction is not a mint from this drop." }) };
  }

  const account = await rpcCall(rpcUrl, "getAccountInfo", [
    args.assetAddress,
    { commitment: "confirmed", encoding: "base64" },
  ]);
  const data = account?.value?.data?.[0];
  if (!data) return { error: json(409, { error: "Asset account not found." }) };
  const asset = decodeAsset(base64.serialize(data));
  if (!asset) return { error: json(409, { error: "Asset account is not a Core asset." }) };
  if (asset.owner !== args.minterWallet) {
    return { error: json(409, { error: "Asset is not owned by your wallet." }) };
  }
  if (asset.collection !== args.collectionAddress) {
    return { error: json(409, { error: "Asset does not belong to this collection." }) };
  }
  return { asset };
}

// The item's image lives in its metadata JSON, which the `nfts` row needs but the asset account
// doesn't carry. Best-effort: a drop whose metadata is briefly unreachable should still record
// the mint — the URI is stored either way, so the image can be backfilled from it later.
async function imageFromMetadata(uri: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(uri)) return null;
  try {
    const response = await fetch(uri, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const metadata = await response.json();
    return typeof metadata?.image === "string" ? metadata.image : null;
  } catch {
    return null;
  }
}

type CollectionRow = {
  id: string;
  creator_id: string;
  collection_address: string | null;
  candy_machine_address: string | null;
};

/**
 * Which phase this mint belongs to, and what it cost.
 *
 * Read from the phase rows rather than from the transaction: the guard group the chain applied is
 * the one whose window contains the block time, so resolving by clock reproduces the chain's own
 * choice. Only phases that were actually deployed as guards (`guard_label` set) are candidates.
 */
async function resolvePhase(
  admin: Admin,
  collectionId: string,
  atMs: number
): Promise<{ phaseId: string | null; priceLamports: bigint }> {
  const { data } = await admin
    .from("mint_phases")
    .select("id, price_lamports, starts_at, ends_at, position")
    .eq("collection_id", collectionId)
    .not("guard_label", "is", null)
    .order("position", { ascending: true });
  const phases = (data ?? []) as {
    id: string;
    price_lamports: number | string;
    starts_at: string;
    ends_at: string | null;
    position: number;
  }[];
  const match = phases.find((p) => {
    const start = new Date(p.starts_at).getTime();
    const end = p.ends_at ? new Date(p.ends_at).getTime() : null;
    return atMs >= start && (end === null || atMs < end);
  });
  if (!match) return { phaseId: null, priceLamports: 0n };
  return { phaseId: match.id, priceLamports: BigInt(String(match.price_lamports)) };
}

async function record(
  admin: Admin,
  userId: string,
  body: { collectionId: string; assetAddress: string; signature: string }
): Promise<Response> {
  // Replay guard first: the client retries `record` after a network blip, and re-verifying an
  // already-recorded mint would race the unique constraint instead of just answering.
  const { data: existing } = await admin
    .from("candy_machine_mints")
    .select("id, nft_id")
    .eq("signature", body.signature)
    .maybeSingle();
  if (existing) return json(200, { ok: true, alreadyRecorded: true, nftId: existing.nft_id });

  const { data: collectionData, error: collectionError } = await admin
    .from("collections")
    .select("id, creator_id, collection_address, candy_machine_address")
    .eq("id", body.collectionId)
    .maybeSingle();
  if (collectionError) return json(500, { error: collectionError.message });
  const collection = collectionData as CollectionRow | null;
  if (!collection) return json(404, { error: "Collection not found." });
  if (!collection.candy_machine_address || !collection.collection_address) {
    return json(409, { error: "This collection is not a candy machine drop." });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("wallet_address")
    .eq("id", userId)
    .maybeSingle();
  const minterWallet = profile?.wallet_address;
  if (!minterWallet) return json(409, { error: "Your profile has no wallet address." });

  const rpcUrl = Deno.env.get("SOLANA_RPC_URL");
  if (!rpcUrl) return json(500, { error: "SOLANA_RPC_URL is not configured" });

  const verified = await verifyMint(rpcUrl, {
    signature: body.signature,
    minterWallet,
    assetAddress: body.assetAddress,
    candyMachine: collection.candy_machine_address,
    collectionAddress: collection.collection_address,
  });
  if ("error" in verified) return verified.error;
  const { asset } = verified;

  const { phaseId, priceLamports } = await resolvePhase(admin, collection.id, Date.now());

  // Position within the collection. Counted server-side because the client has no authority to
  // claim one — and because two buyers minting at once must not both claim the same number.
  const { count } = await admin
    .from("nfts")
    .select("id", { count: "exact", head: true })
    .eq("collection_id", collection.id);

  const imageUrl = (await imageFromMetadata(asset.uri)) ?? asset.uri;

  const { data: nft, error: nftError } = await admin
    .from("nfts")
    .insert({
      asset_address: body.assetAddress,
      collection_id: collection.id,
      // The creator minted the *drop*; the buyer minted this item and owns it.
      creator_id: collection.creator_id,
      owner_id: userId,
      owner_wallet: minterWallet,
      name: asset.name,
      image_url: imageUrl,
      metadata_url: asset.uri,
      edition_number: (count ?? 0) + 1,
      mint_tx: body.signature,
    })
    .select("id")
    .single();
  if (nftError) {
    // A unique violation on asset_address means a concurrent call won the race — not an error
    // the buyer can act on, and their asset is recorded either way.
    if (nftError.code === "23505") {
      const { data: raced } = await admin
        .from("nfts")
        .select("id")
        .eq("asset_address", body.assetAddress)
        .maybeSingle();
      if (raced) return json(200, { ok: true, alreadyRecorded: true, nftId: raced.id });
    }
    return json(500, { error: `Minted on chain, but recording it failed: ${nftError.message}` });
  }

  const { error: mintError } = await admin.from("candy_machine_mints").insert({
    collection_id: collection.id,
    nft_id: nft.id,
    minter_id: userId,
    asset_address: body.assetAddress,
    signature: body.signature,
    price_lamports: priceLamports.toString(),
    phase_id: phaseId,
  });
  if (mintError && mintError.code !== "23505") {
    return json(500, { error: `Minted on chain, but recording it failed: ${mintError.message}` });
  }

  await admin.from("activities").insert({
    type: "mint",
    nft_id: nft.id,
    actor_id: userId,
    lamports: priceLamports.toString(),
    tx_signature: body.signature,
  });

  // Derived display data the new row changes. Cosmetic — the mint is already on chain and
  // recorded, so a failure here is logged rather than turned into an error for the buyer.
  const [stats, rarity] = await Promise.all([
    admin.rpc("refresh_collection_stats", { p_collection: collection.id }),
    admin.rpc("recompute_collection_rarity", { p_collection: collection.id }),
  ]);
  if (stats.error) console.error(`refresh_collection_stats failed: ${stats.error.message}`);
  if (rarity.error) console.error(`recompute_collection_rarity failed: ${rarity.error.message}`);

  return json(200, { ok: true, nftId: nft.id, name: asset.name, editionNumber: (count ?? 0) + 1 });
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

    if (
      body.action === "record" &&
      typeof body.collectionId === "string" &&
      typeof body.assetAddress === "string" &&
      typeof body.signature === "string"
    ) {
      return await record(admin, user.id, body);
    }
    return json(400, { error: "Unknown action." });
  } catch (e) {
    console.error(e);
    return json(500, { error: e instanceof Error ? e.message : "Recording the mint failed." });
  }
});

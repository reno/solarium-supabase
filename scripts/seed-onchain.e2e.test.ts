// Seed the local database with *real* devnet state: Core collections and assets that actually
// exist on chain, listed with a real TransferDelegate so a sale can settle for real.
//
//   pnpm seed:onchain
//
// This is the ONLY source of collections in a seeded database. `supabase/seed.sql` stops at the
// cast (profiles, follows, one launch application) because a fabricated collection is a dead end:
// its asset can't be fetched from the RPC, so nothing about it can be bought, bid on or settled.
//
// It produces three halves:
//
//   1. Creator personas with real collections. Throwaway keypairs (persisted in
//      .e2e-onchain-wallets.json, gitignored) are bound to the seed's `solara` and `lumen_labs`
//      personas — the same auth.identities rebind `pnpm seed:e2e` does — then sign in as them,
//      mint a collection, grant the settlement authority a TransferDelegate, and list every item.
//      Because the script holds their keys, nothing needs your wallet, and your Phantom can buy
//      those listings through the settle function for real.
//   2. The market and social layer, built on those real items: an approved launch application
//      (which is what flips `verified`), likes, comments, soft offers, a collection offer, and a
//      phased launchpad drop with the collector personas allowlisted.
//   3. A hand-off. A few more assets are minted and transferred on chain to the wallets you bound
//      with `pnpm seed:e2e`, so those personas own genuine devnet assets.
//
// Shaped as a vitest file (skipped unless SEED_ONCHAIN=1) for the same reason mint.e2e.test.ts is:
// it's the repo's only TypeScript runner, so the script can call mintNfts/listNfts directly
// instead of reimplementing them.
//
// Funding: Core rent is ~0.0035 SOL per asset, so a default run costs well under 0.1 SOL. The
// devnet faucet is rate limited (Helius allows 1 SOL per project per day), so when it refuses the
// script prints an address and waits for you to send devnet SOL from your own wallet.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { fetchAllAssets, mplCore, transferV1 } from "@metaplex-foundation/mpl-core";
import {
  keypairIdentity,
  publicKey,
  sol,
  type Keypair,
  type Umi,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

import { listNfts } from "@/lib/listings/listings";
import { mintNfts } from "@/lib/mint/mint";
import { withRpcRetry } from "@/lib/solana/retry";

const ENABLED = process.env.SEED_ONCHAIN === "1";
const WALLET_FILE = ".e2e-onchain-wallets.json";
const SUPABASE_URL = "http://127.0.0.1:54321";
const DOMAIN = "localhost:3000";

/** Rent for a Core asset plus fees, with headroom for the listing transactions. */
const COST_PER_ITEM_SOL = 0.008;
const MIN_SELLER_BALANCE_SOL = 0.05;

const num = (name: string, fallback: number) =>
  process.env[name] ? Number(process.env[name]) : fallback;

const ITEMS_PER_SELLER = num("SEED_ONCHAIN_ITEMS", 3);
const HANDOFF_ITEMS = num("SEED_ONCHAIN_HANDOFF_ITEMS", 3);
const PRICE_SOL = num("SEED_ONCHAIN_PRICE_SOL", 0.02);

// Cheap on purpose: these listings are meant to be *bought* with devnet SOL, and a realistic
// multi-SOL floor would drain a faucet wallet.
const PRICE_LAMPORTS = BigInt(Math.round(PRICE_SOL * 1_000_000_000));

/** The seed personas this script signs in as. Their profiles/bios/followers come from seed.sql. */
const SELLERS = [
  {
    persona: "solara",
    id: "10000000-0000-4000-8000-000000000001",
    collection: "Solar Flare",
    description: "Minted on devnet by the on-chain seed. Real assets, real delegates.",
    hue: 28,
    launchpad: true,
  },
  {
    persona: "lumen_labs",
    id: "10000000-0000-4000-8000-000000000002",
    collection: "Relic Cache",
    description: "A second on-chain series, listed and ready to settle.",
    hue: 268,
    launchpad: false,
  },
];

/** The seed's collectors — they like, comment and bid on whatever gets minted here. */
const COLLECTORS = ["orbit", "vega", "ceres_eth"];

type Collector = { id: string; username: string; wallet_address: string | null };
type MintedCollection = {
  seller: (typeof SELLERS)[number];
  sellerUserId: string;
  collectionId: string;
  collectionAddress: string;
  nftIds: string[];
  /** False when this run reused what an earlier one minted — its social layer already exists. */
  fresh: boolean;
};

// --- environment ------------------------------------------------------------

/** Load .env.local without pulling in a dotenv dependency (Next does this itself). */
function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

/** Local stack keys, straight from the CLI when they aren't already in the env. */
function stackKeys(): { anonKey: string; serviceRoleKey: string } {
  const fromEnv = {
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (fromEnv.anonKey && fromEnv.serviceRoleKey) {
    return { anonKey: fromEnv.anonKey, serviceRoleKey: fromEnv.serviceRoleKey };
  }
  const status = JSON.parse(
    execFileSync("pnpm", ["supabase", "status", "-o", "json"], { encoding: "utf8" })
  );
  return {
    anonKey: fromEnv.anonKey ?? status.ANON_KEY,
    serviceRoleKey: fromEnv.serviceRoleKey ?? status.SERVICE_ROLE_KEY,
  };
}

// --- wallets ----------------------------------------------------------------

type StoredWallet = { username: string; address: string; secretKey: number[] };

/**
 * Reuse keypairs across runs: a fresh key would mean rebinding the persona every time and
 * stranding the assets the previous run minted under the old one.
 */
function loadOrCreateWallets(umi: Umi): Map<string, Keypair> {
  const stored: StoredWallet[] = existsSync(WALLET_FILE)
    ? JSON.parse(readFileSync(WALLET_FILE, "utf8"))
    : [];
  const wallets = new Map<string, Keypair>();
  const toStore = [...stored];

  for (const seller of SELLERS) {
    const found = stored.find((w) => w.username === seller.persona);
    if (found) {
      wallets.set(seller.persona, umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(found.secretKey)));
      continue;
    }
    const keypair = umi.eddsa.generateKeypair();
    wallets.set(seller.persona, keypair);
    toStore.push({
      username: seller.persona,
      address: keypair.publicKey.toString(),
      secretKey: Array.from(keypair.secretKey),
    });
  }

  writeFileSync(WALLET_FILE, JSON.stringify(toStore, null, 2));
  return wallets;
}

/**
 * Give the creator personas the script's keypairs, so signing in with them resolves to the seeded
 * user (with its bio, followers and social) instead of creating a fresh anonymous one. Shells out
 * to the same binder you'd run by hand — it owns the auth.identities details that make web3
 * sign-in match an existing user.
 */
function bindPersonas(wallets: Map<string, Keypair>) {
  const assignments = SELLERS.map(
    (seller) => `${seller.persona}=${wallets.get(seller.persona)!.publicKey.toString()}`
  );
  console.log(`\n  binding ${assignments.join(" ")}…`);
  try {
    // --force clears any *other* auth user already holding these addresses (a run from before
    // the personas were adopted, say). That cascades to its rows, which is the point: their
    // listings were stale the moment the wallet changed hands.
    execFileSync("node", ["scripts/seed-e2e.mjs", ...assignments, "--force"], {
      stdio: "inherit",
      env: { ...process.env, SEED_ONCHAIN_BINDING: "1" },
    });
  } catch {
    throw new Error(
      "binding the creator personas failed — is seed.sql loaded? Run `pnpm supabase db reset` first."
    );
  }
}

// --- funding ----------------------------------------------------------------

const solOf = (basisPoints: bigint) => Number(basisPoints) / 1_000_000_000;

/**
 * Top up a seller key. The faucet is the happy path; when it's dry or rate limited the run pauses
 * and waits for a manual transfer instead of failing — you have devnet SOL in Phantom, the script
 * doesn't.
 */
async function ensureFunded(umi: Umi, address: string, neededSol: number) {
  const balance = async () => solOf((await umi.rpc.getBalance(publicKey(address))).basisPoints);

  let have = await balance();
  if (have >= neededSol) return have;

  try {
    await umi.rpc.airdrop(publicKey(address), sol(Math.max(neededSol, 0.1)));
    have = await balance();
    if (have >= neededSol) {
      console.log(`    funded ${address} from the faucet (${have.toFixed(4)} SOL)`);
      return have;
    }
  } catch {
    // Rate limited or dry — fall through to the manual path.
  }

  const short = (neededSol - have).toFixed(3);
  console.log(
    `\n  ⚠  ${address} needs ${short} more devnet SOL and the faucet declined.\n` +
      `     Send it from your wallet, and this will continue automatically.\n` +
      `     Waiting up to 5 minutes…\n`
  );
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    have = await balance();
    if (have >= neededSol) {
      console.log(`    received — ${address} now holds ${have.toFixed(4)} SOL`);
      return have;
    }
  }
  throw new Error(`${address} was never funded (needs ${neededSol} SOL)`);
}

/**
 * Wait until every freshly minted asset is readable from the RPC.
 *
 * The mint confirms at "confirmed" commitment, which says the transaction landed — not that the
 * node you ask next has the account yet. Nothing in the app hits that gap (a human lists minutes
 * later), but this script mints and immediately lists, and `listNfts`/`transferV1` both start by
 * fetching the asset — which throws an unretried AccountNotFoundError when the read lands early.
 */
async function waitForAssets(umi: Umi, addresses: string[], timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; ; attempt++) {
    try {
      await fetchAllAssets(umi, addresses.map((address) => publicKey(address)));
      return;
    } catch (e) {
      if (Date.now() >= deadline) throw e;
      if (attempt === 1) console.log(`    waiting for ${addresses.length} assets to be readable…`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

// --- art --------------------------------------------------------------------

/**
 * Generated cover art. An SVG keeps the script dependency-free, and Storage serves it with a
 * content type the app's tiles render happily.
 */
function svgArt(hue: number, label: string): Blob {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
  <defs>
    <radialGradient id="g" cx="50%" cy="38%" r="70%">
      <stop offset="0%" stop-color="hsl(${hue} 95% 62%)"/>
      <stop offset="55%" stop-color="hsl(${(hue + 22) % 360} 80% 34%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 40) % 360} 60% 8%)"/>
    </radialGradient>
  </defs>
  <rect width="600" height="600" fill="url(#g)"/>
  <circle cx="300" cy="228" r="118" fill="none" stroke="hsl(${hue} 100% 82%)" stroke-width="2" opacity="0.65"/>
  <circle cx="300" cy="228" r="164" fill="none" stroke="hsl(${hue} 100% 82%)" stroke-width="1" opacity="0.35"/>
  <text x="300" y="516" text-anchor="middle" font-family="ui-monospace, monospace"
        font-size="30" letter-spacing="6" fill="hsl(${hue} 100% 88%)">${label}</text>
</svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
}

// --- auth -------------------------------------------------------------------

/** Sign in a script-held keypair exactly the way the browser wallet flow does. */
async function signInAs(umi: Umi, supabase: SupabaseClient, keypair: Keypair) {
  const address = keypair.publicKey.toString();
  const message = [
    `${DOMAIN} wants you to sign in with your Solana account:`,
    address,
    "",
    "Sign in to Solarium with your Solana wallet.",
    "",
    `URI: http://${DOMAIN}/`,
    "Version: 1",
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
  const signature = await umi.eddsa.sign(new TextEncoder().encode(message), keypair);
  const { data, error } = await supabase.auth.signInWithWeb3({
    chain: "solana",
    message,
    signature,
  });
  if (error) throw new Error(`sign-in failed for ${address}: ${error.message}`);
  return data.user!.id;
}

// --- the off-chain layer over the real items --------------------------------

/** This seed's collection for a persona, if an earlier run already minted it. */
async function existingCollection(
  admin: SupabaseClient,
  seller: (typeof SELLERS)[number],
  sellerUserId: string
): Promise<MintedCollection | null> {
  const { data } = await admin
    .from("collections")
    .select("id, collection_address, nfts(id)")
    .eq("creator_id", sellerUserId)
    .eq("name", seller.collection)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || !data.collection_address) return null;
  const nftIds = (data.nfts as { id: string }[]).map((nft) => nft.id);
  if (nftIds.length === 0) return null;
  return {
    seller,
    sellerUserId,
    collectionId: data.id,
    collectionAddress: data.collection_address,
    nftIds,
    fresh: false,
  };
}

/**
 * Verification is the trigger's job: `launch_application_verified` flips `collections.verified`
 * when a creator's application is approved, and it only fires on the application row — so the
 * approval has to be inserted *after* the collection exists.
 */
async function approveCreator(admin: SupabaseClient, entry: MintedCollection) {
  const { data: existing } = await admin
    .from("launch_applications")
    .select("id")
    .eq("creator_id", entry.sellerUserId)
    .eq("status", "approved")
    .limit(1);
  if (existing && existing.length > 0) {
    // Re-approve so the trigger runs again for this run's new collection.
    await admin.from("launch_applications").update({ status: "approved" }).eq("id", existing[0].id);
    return;
  }
  const { error } = await admin.from("launch_applications").insert({
    creator_id: entry.sellerUserId,
    name: entry.seller.collection,
    description: "Vetted on-chain drop, approved by the seed.",
    status: "approved",
  });
  if (error) throw new Error(`approving ${entry.seller.persona} failed: ${error.message}`);
}

/**
 * Likes, comments and soft offers from the seed's collectors. All three are off-chain features by
 * design (no chain state at all), so seeding them is honest — they just need real items to hang
 * off, which is why they live here rather than in seed.sql.
 */
async function seedSocial(admin: SupabaseClient, collectors: Collector[], minted: MintedCollection[]) {
  const likes: { profile_id: string; nft_id: string; created_at: string }[] = [];
  const comments: { profile_id: string; nft_id: string; body: string; created_at: string }[] = [];
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

  const chatter = [
    "This one is clean. GLWS.",
    "Real assets, real delegate — bought one to test the settle path.",
    "The finish on these is unreal in person.",
  ];

  for (const [entryIndex, entry] of minted.entries()) {
    entry.nftIds.forEach((nftId, itemIndex) => {
      collectors.forEach((collector, collectorIndex) => {
        if ((itemIndex + collectorIndex + entryIndex) % 2 !== 0) return;
        likes.push({ profile_id: collector.id, nft_id: nftId, created_at: hoursAgo(itemIndex * 5 + 2) });
      });
    });

    const first = entry.nftIds[0];
    if (first) {
      comments.push({
        profile_id: collectors[entryIndex % collectors.length].id,
        nft_id: first,
        body: chatter[entryIndex % chatter.length],
        created_at: hoursAgo(6 + entryIndex * 3),
      });
    }
  }

  if (likes.length > 0) {
    const { error } = await admin.from("likes").upsert(likes, { onConflict: "profile_id,nft_id", ignoreDuplicates: true });
    if (error) throw new Error(`seeding likes failed: ${error.message}`);
  }
  if (comments.length > 0) {
    const { error } = await admin.from("comments").insert(comments);
    if (error) throw new Error(`seeding comments failed: ${error.message}`);
  }
  console.log(`    ✓ ${likes.length} likes, ${comments.length} comments`);
}

/** Soft offers: a DB row, non-binding until the seller accepts — nothing is escrowed. */
async function seedOffers(admin: SupabaseClient, collectors: Collector[], minted: MintedCollection[]) {
  const bidPrice = (fraction: number) => (PRICE_LAMPORTS * BigInt(Math.round(fraction * 100))) / 100n;
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

  // Every row carries the same keys: PostgREST rejects a bulk insert whose objects disagree, and
  // an offer targets either an item or a whole collection (the table's one-target check).
  const rows = minted.flatMap((entry, index) => {
    const itemBidder = collectors[index % collectors.length];
    const collectionBidder = collectors[(index + 1) % collectors.length];
    const first = entry.nftIds[0];
    return [
      ...(first
        ? [
            {
              nft_id: first,
              collection_id: null,
              bidder_id: itemBidder.id,
              price_lamports: bidPrice(0.9).toString(),
              quantity: 1,
              status: "active",
              expires_at: inDays(4),
              created_at: hoursAgo(9),
            },
          ]
        : []),
      {
        nft_id: null,
        collection_id: entry.collectionId,
        bidder_id: collectionBidder.id,
        price_lamports: bidPrice(0.8).toString(),
        quantity: 2,
        status: "active",
        expires_at: inDays(5),
        created_at: hoursAgo(6),
      },
    ];
  });
  if (rows.length === 0) return;

  const { data: inserted, error } = await admin.from("offers").insert(rows).select("id, nft_id, bidder_id, price_lamports, created_at");
  if (error) throw new Error(`seeding offers failed: ${error.message}`);

  const { error: activityError } = await admin.from("activities").insert(
    inserted.map((offer) => ({
      type: "bid",
      nft_id: offer.nft_id,
      actor_id: offer.bidder_id,
      lamports: offer.price_lamports,
      created_at: offer.created_at,
    }))
  );
  if (activityError) throw new Error(`recording bid activity failed: ${activityError.message}`);
  console.log(`    ✓ ${inserted.length} soft offers (item + collection)`);
}

/**
 * A phased drop over one real collection, so the launchpad has something live. Enforcement is
 * advisory (app-layer, not on chain) — minting through it is really a buy of the creator's
 * listing, which is exactly why the phase prices match the listing price.
 */
async function seedLaunchpad(admin: SupabaseClient, collectors: Collector[], entry: MintedCollection) {
  const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();
  const allowlistPrice = (PRICE_LAMPORTS * 8n) / 10n;

  const { error } = await admin.from("mint_phases").insert([
    {
      collection_id: entry.collectionId,
      name: "Allowlist",
      price_lamports: allowlistPrice.toString(),
      starts_at: at(-48),
      ends_at: at(-24),
      per_wallet_limit: 2,
      allowlist_only: true,
      position: 0,
    },
    {
      collection_id: entry.collectionId,
      name: "Public",
      price_lamports: PRICE_LAMPORTS.toString(),
      starts_at: at(-24),
      ends_at: at(48),
      per_wallet_limit: 5,
      allowlist_only: false,
      position: 1,
    },
  ]);
  if (error) throw new Error(`seeding mint phases failed: ${error.message}`);

  const allowlist = collectors
    .filter((collector) => collector.wallet_address)
    .slice(0, 2)
    .map((collector) => ({ collection_id: entry.collectionId, wallet_address: collector.wallet_address! }));
  if (allowlist.length > 0) {
    const { error: allowlistError } = await admin
      .from("launchpad_allowlist")
      .upsert(allowlist, { onConflict: "collection_id,wallet_address", ignoreDuplicates: true });
    if (allowlistError) throw new Error(`seeding the allowlist failed: ${allowlistError.message}`);
  }
  console.log(`    ✓ launchpad drop on "${entry.seller.collection}" (${allowlist.length} allowlisted)`);
}

// --- the seed ---------------------------------------------------------------

it.skipIf(!ENABLED)("seeds real devnet collections, listings and owned assets", { timeout: 900_000 }, async () => {
  loadEnvFile(".env.local");
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error("NEXT_PUBLIC_SOLANA_RPC_URL is not set");
  if (!process.env.NEXT_PUBLIC_SETTLEMENT_AUTHORITY) {
    throw new Error("NEXT_PUBLIC_SETTLEMENT_AUTHORITY is not set — listings need a delegate target");
  }
  const { anonKey, serviceRoleKey } = stackKeys();
  const admin = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const baseUmi = createUmi(rpcUrl).use(mplCore());
  const wallets = loadOrCreateWallets(baseUmi);
  bindPersonas(wallets);

  const sellerUserIds: string[] = [];
  const minted: MintedCollection[] = [];

  // --- 1. creator personas: mint, then list at a price you can afford -------
  for (const seller of SELLERS) {
    const keypair = wallets.get(seller.persona)!;
    const address = keypair.publicKey.toString();
    console.log(`\n  ${seller.persona} (${address})`);

    const needed = Math.max(
      MIN_SELLER_BALANCE_SOL,
      (ITEMS_PER_SELLER + (seller === SELLERS[0] ? HANDOFF_ITEMS : 0)) * COST_PER_ITEM_SOL + 0.02
    );
    await ensureFunded(baseUmi, address, needed);

    const umi = createUmi(rpcUrl).use(mplCore()).use(keypairIdentity(keypair));
    const supabase = createClient(SUPABASE_URL, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const userId = await signInAs(umi, supabase, keypair);
    // The bind above is what makes this hold: without it, sign-in would mint a fresh user and the
    // collection would belong to a profile with no bio, no followers and no social.
    expect(userId).toBe(seller.id);
    sellerUserIds.push(userId);

    // Re-running shouldn't mint a second "Solar Flare" next to the first: reuse what's there and
    // leave its social layer alone, so a re-run is free and idempotent (it exists to pick up a
    // newly bound wallet for the hand-off, not to double the world).
    const existing = await existingCollection(admin, seller, userId);
    if (existing) {
      minted.push(existing);
      console.log(`    ✓ reusing ${existing.nftIds.length} existing items — nothing to mint`);
      continue;
    }

    console.log(`    minting ${ITEMS_PER_SELLER}× "${seller.collection}"…`);
    const result = await mintNfts({
      supabase,
      umi,
      creatorId: userId,
      file: svgArt(seller.hue, seller.collection.toUpperCase()),
      fileName: "art.svg",
      name: seller.collection,
      description: seller.description,
      quantity: ITEMS_PER_SELLER,
    });
    expect(result.assetAddresses.length).toBe(ITEMS_PER_SELLER);
    expect(result.collectionAddress).toBeTruthy();
    await waitForAssets(umi, result.assetAddresses);

    // listNfts wants row ids, which mintNfts doesn't return. Every item in one mint shares the
    // collection it just returned, so no join is needed.
    const { data: rows } = await supabase
      .from("nfts")
      .select("id, asset_address, collection_id")
      .in("asset_address", result.assetAddresses);

    const entry: MintedCollection = {
      seller,
      sellerUserId: userId,
      collectionId: rows![0].collection_id,
      collectionAddress: result.collectionAddress!,
      nftIds: rows!.map((row) => row.id),
      fresh: true,
    };
    minted.push(entry);

    console.log(`    listing ${rows!.length} at ${PRICE_SOL} SOL…`);
    const { listed } = await listNfts({
      supabase,
      umi,
      nfts: rows!.map((row) => ({
        id: row.id,
        assetAddress: row.asset_address,
        collectionAddress: result.collectionAddress,
      })),
      sellerId: userId,
      priceLamports: PRICE_LAMPORTS,
      expiresInHours: 24 * 14,
    });
    expect(listed).toBe(rows!.length);
    console.log(`    ✓ ${listed} live listings, delegate granted`);

    await approveCreator(admin, entry);
    console.log(`    ✓ launch application approved → collection verified`);
  }

  // --- 2. the market and social layer over those real items -----------------
  const { data: collectors } = await admin
    .from("profiles")
    .select("id, username, wallet_address")
    .in("username", COLLECTORS);

  // Only over what this run minted: a reused collection already carries its likes, comments and
  // offers, and re-inserting them would collide with the one-active-offer-per-bidder index.
  const freshlyMinted = minted.filter((entry) => entry.fresh);

  if (!collectors || collectors.length === 0) {
    console.log("\n  No collector personas — run `pnpm supabase db reset` to load seed.sql first.");
  } else if (freshlyMinted.length === 0) {
    console.log("\n  off-chain layer: already seeded on the existing collections.");
  } else {
    console.log("\n  off-chain layer:");
    await seedSocial(admin, collectors, freshlyMinted);
    await seedOffers(admin, collectors, freshlyMinted);
    const drop = freshlyMinted.find((entry) => entry.seller.launchpad);
    if (drop) await seedLaunchpad(admin, collectors, drop);
  }

  // --- 3. hand-off: real assets transferred to the wallets you bound --------

  // A bound wallet is one with a web3 identity — the placeholder personas from seed.sql have none
  // until `pnpm seed:e2e` gives them one. The sellers are bound too, so they're filtered out.
  // Checked, not swallowed: GoTrue 500s on this endpoint ("Database error finding users") if any
  // auth.users row has a NULL token column, and an unchecked error reads as "nothing is bound" —
  // the hand-off would quietly do nothing. seed.sql writes '' for exactly this reason.
  const { data: userList, error: userListError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (userListError) {
    throw new Error(
      `listing auth users failed (${userListError.message}) — a seeded auth.users row probably has ` +
        "NULL token columns; re-run `pnpm supabase db reset` to pick up the current seed.sql."
    );
  }
  // …and the identities have to be fetched one by one: this GoTrue version returns them on
  // getUserById but omits them from the list response, where `identities` is always empty.
  const boundIds: string[] = [];
  for (const user of userList.users) {
    if (sellerUserIds.includes(user.id)) continue;
    const { data: full } = await admin.auth.admin.getUserById(user.id);
    if (full?.user?.identities?.some((identity) => identity.provider === "web3")) {
      boundIds.push(user.id);
    }
  }
  const { data: allTargets } = await admin
    .from("profiles")
    .select("id, username, wallet_address, nfts:nfts!nfts_owner_id_fkey(id)")
    .in("id", boundIds.length > 0 ? boundIds : ["00000000-0000-4000-8000-000000000000"]);

  // Skip wallets that already hold items, so re-runs don't pile up hand-off collections.
  const targets = (allTargets ?? []).filter((target) => (target.nfts as { id: string }[]).length === 0);

  if (allTargets && allTargets.length > 0 && targets.length === 0) {
    console.log("\n  hand-off: bound wallets already hold items — nothing to send.");
  } else if (targets.length === 0) {
    console.log("\n  No bound wallets found — run `pnpm seed:e2e <address>` first to get the hand-off.");
  } else {
    const seller = SELLERS[0];
    const keypair = wallets.get(seller.persona)!;
    const umi = createUmi(rpcUrl).use(mplCore()).use(keypairIdentity(keypair));
    const supabase = createClient(SUPABASE_URL, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const userId = await signInAs(umi, supabase, keypair);

    console.log(`\n  hand-off: minting ${HANDOFF_ITEMS} for ${targets.map((t) => t.username).join(", ")}…`);
    const result = await mintNfts({
      supabase,
      umi,
      creatorId: userId,
      file: svgArt(198, "FIELD NOTES"),
      fileName: "art.svg",
      name: "Field Notes",
      description: "Handed off on chain by the on-chain seed.",
      quantity: HANDOFF_ITEMS,
    });
    await waitForAssets(umi, result.assetAddresses);

    const { data: rows } = await supabase
      .from("nfts")
      .select("id, asset_address")
      .in("asset_address", result.assetAddresses);

    for (const [index, row] of rows!.entries()) {
      const target = targets[index % targets.length];
      const builder = transferV1(umi, {
        asset: publicKey(row.asset_address),
        newOwner: publicKey(target.wallet_address!),
        ...(result.collectionAddress ? { collection: publicKey(result.collectionAddress) } : {}),
      });
      const blockhash = await withRpcRetry(() => umi.rpc.getLatestBlockhash());
      const signed = await withRpcRetry(() => builder.setBlockhash(blockhash).buildAndSign(umi));
      const signatureBytes = await withRpcRetry(() => umi.rpc.sendTransaction(signed));
      await withRpcRetry(() =>
        umi.rpc.confirmTransaction(signatureBytes, { strategy: { type: "blockhash", ...blockhash } })
      );

      // Ownership updates have no RLS policy by design (see the init migration), so the DB half
      // runs with the service role, as settlement does.
      const { error: ownerError } = await admin
        .from("nfts")
        .update({ owner_id: target.id, owner_wallet: target.wallet_address })
        .eq("id", row.id);
      if (ownerError) throw new Error(`recording the transfer failed: ${ownerError.message}`);
      await admin.from("activities").insert({
        type: "gift",
        nft_id: row.id,
        actor_id: userId,
        counterparty_id: target.id,
      });
      console.log(`    ✓ ${row.asset_address} → ${target.username}`);
    }
  }

  // --- 4. derived display data ---------------------------------------------
  // Rarity is a no-op while the quick mint records no traits; stats write a zeroed sparkline so a
  // never-traded collection reads as "no sales yet" rather than as missing data.
  for (const entry of minted) {
    await admin.rpc("refresh_collection_stats", { p_collection: entry.collectionId });
    await admin.rpc("recompute_collection_rarity", { p_collection: entry.collectionId });
  }

  // --- summary --------------------------------------------------------------
  const explorer = (address: string) =>
    `https://explorer.solana.com/address/${address}?cluster=devnet`;
  console.log("\n  On-chain seed complete.\n");
  for (const entry of minted) {
    console.log(`  ${entry.seller.persona}: ${entry.nftIds.length} items listed at ${PRICE_SOL} SOL`);
    console.log(`    collection ${explorer(entry.collectionAddress)}`);
  }
  console.log(`\n  Buy one from the app with a bound wallet — settlement is real.\n`);
});

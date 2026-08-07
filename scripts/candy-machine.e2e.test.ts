// End-to-end proof that the enforced launchpad works against a real chain: deploy a candy
// machine for a drop, mint from it with a second wallet, and confirm the guards reject what they
// are supposed to reject.
//
//   pnpm supabase start
//   pnpm supabase functions serve candy-mint --env-file supabase/functions/.env   # another terminal
//   pnpm test:candy
//
// Skipped unless CANDY_E2E=1, and shaped as a vitest file for the same reason the other on-chain
// scripts are: it's the repo's only TypeScript runner, so it can drive the real
// `deployCandyMachine` / `mintFromCandyMachine` the app uses instead of a parallel reimplementation
// that could pass while the app's own path is broken.
//
// It spends real devnet SOL (rent for the machine, plus the mint prices) from the keypairs in
// .e2e-onchain-wallets.json — the same wallets `pnpm seed:onchain` uses.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { mplCore } from "@metaplex-foundation/mpl-core";
import { keypairIdentity, type Keypair, type Umi } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

import {
  deployCandyMachine,
  mintFromCandyMachine,
  readCandyMachineSupply,
} from "@/lib/launchpad/candy-machine";
import { phaseGroupLabel, type PhaseInput } from "@/lib/launchpad/candy-guards";
import { addAllowlist, createPhase } from "@/lib/launchpad/manage";

const ENABLED = process.env.CANDY_E2E === "1";
const WALLET_FILE = ".e2e-onchain-wallets.json";
const SUPABASE_URL = "http://127.0.0.1:54321";
const DOMAIN = "localhost:3000";
const SUPPLY = 3;

const ALLOWLIST_PRICE = 5_000_000n; // 0.005 SOL
const PUBLIC_PRICE = 10_000_000n; // 0.01 SOL

/** Load .env.local without a dotenv dependency (Next does this itself). */
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

function stackKeys(): { anonKey: string; serviceRoleKey: string } {
  const fromEnv = {
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (fromEnv.anonKey && fromEnv.serviceRoleKey) {
    return { anonKey: fromEnv.anonKey, serviceRoleKey: fromEnv.serviceRoleKey };
  }
  const status = JSON.parse(execFileSync("pnpm", ["supabase", "status", "-o", "json"], { encoding: "utf8" }));
  return {
    anonKey: fromEnv.anonKey ?? status.ANON_KEY,
    serviceRoleKey: fromEnv.serviceRoleKey ?? status.SERVICE_ROLE_KEY,
  };
}

type StoredWallet = { username: string; address: string; secretKey: number[] };

function walletKeypair(umi: Umi, username: string): Keypair {
  if (!existsSync(WALLET_FILE)) {
    throw new Error(`${WALLET_FILE} is missing — run \`pnpm seed:onchain\` once to create funded wallets.`);
  }
  const stored: StoredWallet[] = JSON.parse(readFileSync(WALLET_FILE, "utf8"));
  const found = stored.find((w) => w.username === username);
  if (!found) throw new Error(`${WALLET_FILE} has no wallet for "${username}".`);
  return umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(found.secretKey));
}

function umiFor(keypair: Keypair): Umi {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL!;
  return createUmi(rpcUrl).use(mplCore()).use(keypairIdentity(keypair));
}

async function signInAs(umi: Umi, supabase: SupabaseClient, keypair: Keypair): Promise<string> {
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
  const { data, error } = await supabase.auth.signInWithWeb3({ chain: "solana", message, signature });
  if (error) throw new Error(`sign-in failed for ${address}: ${error.message}`);
  return data.user!.id;
}

/** 1×1 transparent PNG, so the drop has real artwork in real storage without shipping a fixture. */
const PIXEL_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);

const phaseInput = (row: { id: string }, overrides: Partial<PhaseInput>): PhaseInput => ({
  id: row.id,
  name: "Phase",
  priceLamports: 0n,
  startsAt: new Date().toISOString(),
  endsAt: null,
  perWalletLimit: null,
  allowlistOnly: false,
  position: 0,
  ...overrides,
});

it.skipIf(!ENABLED)(
  "deploys a candy machine for a drop and mints from it, with the guards enforcing",
  async () => {
    loadEnvFile(".env.local");
    const { anonKey } = stackKeys();

    const bootstrap = createUmi(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!);
    const creatorKeypair = walletKeypair(bootstrap, "solara");
    const minterKeypair = walletKeypair(bootstrap, "lumen_labs");
    const creatorUmi = umiFor(creatorKeypair);
    const minterUmi = umiFor(minterKeypair);
    const creatorWallet = creatorKeypair.publicKey.toString();
    const minterWallet = minterKeypair.publicKey.toString();
    console.log(`\n  creator ${creatorWallet}\n  minter  ${minterWallet}`);

    const creatorClient = createClient(SUPABASE_URL, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const minterClient = createClient(SUPABASE_URL, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const creatorId = await signInAs(creatorUmi, creatorClient, creatorKeypair);
    const minterId = await signInAs(minterUmi, minterClient, minterKeypair);
    expect(creatorId).not.toBe(minterId);

    // --- the drop, as the creator would set it up in the launchpad ---------------------------
    const stamp = Date.now().toString(36);
    const name = `CM E2E ${stamp}`;
    const coverPath = `${creatorId}/${stamp}/cover.png`;
    const { error: uploadError } = await creatorClient.storage
      .from("nft-media")
      .upload(coverPath, new Blob([PIXEL_PNG], { type: "image/png" }), { contentType: "image/png" });
    expect(uploadError).toBeNull();
    const coverUrl = creatorClient.storage.from("nft-media").getPublicUrl(coverPath).data.publicUrl;

    const { data: collection, error: collectionError } = await creatorClient
      .from("collections")
      .insert({ creator_id: creatorId, name, description: "Deployed by the candy machine e2e.", cover_url: coverUrl })
      .select("id")
      .single();
    expect(collectionError).toBeNull();
    const collectionId = collection!.id as string;

    // Two live phases: an allowlist-only one with a per-wallet limit, and an open public one.
    const startsAt = new Date(Date.now() - 60 * 60_000).toISOString();
    await createPhase(creatorClient, {
      collectionId,
      name: "Allowlist",
      priceLamports: ALLOWLIST_PRICE,
      startsAt,
      endsAt: null,
      perWalletLimit: 1,
      allowlistOnly: true,
      position: 0,
    });
    await createPhase(creatorClient, {
      collectionId,
      name: "Public",
      priceLamports: PUBLIC_PRICE,
      startsAt,
      endsAt: null,
      perWalletLimit: null,
      allowlistOnly: false,
      position: 1,
    });
    await addAllowlist(creatorClient, collectionId, [minterWallet]);

    const { data: phaseRows } = await creatorClient
      .from("mint_phases")
      .select("id, name, position")
      .eq("collection_id", collectionId)
      .order("position");
    const allowlistRow = phaseRows!.find((p: { name: string }) => p.name === "Allowlist")!;
    const publicRow = phaseRows!.find((p: { name: string }) => p.name === "Public")!;
    const phases: PhaseInput[] = [
      phaseInput(allowlistRow, {
        name: "Allowlist",
        priceLamports: ALLOWLIST_PRICE,
        startsAt,
        perWalletLimit: 1,
        allowlistOnly: true,
        position: 0,
      }),
      phaseInput(publicRow, { name: "Public", priceLamports: PUBLIC_PRICE, startsAt, position: 1 }),
    ];

    // --- deploy -----------------------------------------------------------------------------
    console.log("  deploying the candy machine…");
    const stages: string[] = [];
    const deployed = await deployCandyMachine({
      supabase: creatorClient,
      umi: creatorUmi,
      collectionId,
      collectionName: name,
      description: "Deployed by the candy machine e2e.",
      collectionAddress: null,
      creatorId,
      creatorWallet,
      imageUrl: coverUrl,
      supply: SUPPLY,
      phases,
      allowlist: [minterWallet],
      onStage: (stage) => stages.push(stage),
    });
    console.log(`    candy machine ${deployed.candyMachineAddress}`);
    expect(stages).toEqual(["metadata", "collection", "machine", "recording", "items"]);
    expect(deployed.itemsLoaded).toBe(SUPPLY);

    // The machine on chain agrees with what was recorded.
    const onChain = await readCandyMachineSupply(creatorUmi, deployed.candyMachineAddress);
    expect(onChain).toEqual({ itemsAvailable: SUPPLY, itemsLoaded: SUPPLY, itemsRedeemed: 0 });

    const { data: machineRow } = await creatorClient
      .from("candy_machines")
      .select("*")
      .eq("collection_id", collectionId)
      .single();
    expect(machineRow.candy_machine_address).toBe(deployed.candyMachineAddress);
    expect(machineRow.items_loaded).toBe(SUPPLY);
    expect(machineRow.prefix_name).toContain("#");

    // Phases were labelled in run order, which is how a mint names its guard group.
    const { data: labelled } = await creatorClient
      .from("mint_phases")
      .select("id, group_label")
      .eq("collection_id", collectionId);
    const labelOf = (id: string) => labelled!.find((p: { id: string }) => p.id === id)!.group_label;
    expect(labelOf(allowlistRow.id)).toBe(phaseGroupLabel(0));
    expect(labelOf(publicRow.id)).toBe(phaseGroupLabel(1));

    // --- mint (public phase) ------------------------------------------------------------------
    console.log("  minting from the public phase…");
    const publicMint = await mintFromCandyMachine({
      supabase: minterClient,
      umi: minterUmi,
      collectionId,
      collectionAddress: deployed.collectionAddress,
      candyMachineAddress: deployed.candyMachineAddress,
      creatorWallet,
      allowlist: [minterWallet],
      phase: { ...phases[1], groupLabel: phaseGroupLabel(1) },
    });
    console.log(`    minted ${publicMint.assetAddress}`);
    expect(publicMint.nftId).toBeTruthy();

    // The recorder wrote a row the minter could not have written themselves.
    const { data: nft } = await minterClient
      .from("nfts")
      .select("id, owner_id, creator_id, collection_id, name, metadata_url, image_url, mint_tx")
      .eq("asset_address", publicMint.assetAddress)
      .single();
    expect(nft).toBeTruthy();
    expect(nft!.owner_id).toBe(minterId);
    expect(nft!.creator_id).toBe(creatorId);
    expect(nft!.collection_id).toBe(collectionId);
    expect(nft!.name.startsWith(machineRow.prefix_name.trim().replace(/#$/, "").trim())).toBe(true);
    expect(nft!.metadata_url.startsWith(machineRow.prefix_uri)).toBe(true);
    expect(nft!.mint_tx).toBe(publicMint.signature);

    // The creator was paid by the guard, not by this app — and the recorder read that off the
    // transaction's own balance change rather than believing the client. (Asserted through the
    // activity rather than a live `getBalance`, which can still be serving a pre-mint balance.)
    const { data: mintActivity } = await minterClient
      .from("activities")
      .select("type, lamports, tx_signature, actor_id, counterparty_id")
      .eq("nft_id", nft!.id)
      .eq("type", "mint")
      .single();
    expect(mintActivity!.tx_signature).toBe(publicMint.signature);
    expect(mintActivity!.actor_id).toBe(minterId);
    expect(mintActivity!.counterparty_id).toBe(creatorId);
    expect(BigInt(mintActivity!.lamports)).toBeGreaterThanOrEqual(PUBLIC_PRICE);

    // --- mint (allowlist phase, via the merkle proof route) -----------------------------------
    console.log("  minting from the allowlist phase…");
    const allowlistStages: string[] = [];
    const allowlistMint = await mintFromCandyMachine({
      supabase: minterClient,
      umi: minterUmi,
      collectionId,
      collectionAddress: deployed.collectionAddress,
      candyMachineAddress: deployed.candyMachineAddress,
      creatorWallet,
      allowlist: [minterWallet],
      phase: { ...phases[0], groupLabel: phaseGroupLabel(0) },
      onStage: (stage) => allowlistStages.push(stage),
    });
    expect(allowlistStages[0]).toBe("allowlist"); // proved membership before minting
    expect(allowlistMint.nftId).toBeTruthy();

    const { data: machineAfter } = await minterClient
      .from("candy_machines")
      .select("items_redeemed")
      .eq("collection_id", collectionId)
      .single();
    expect(machineAfter!.items_redeemed).toBe(2);
    expect((await readCandyMachineSupply(creatorUmi, deployed.candyMachineAddress)).itemsRedeemed).toBe(2);

    // --- what the guards must refuse -----------------------------------------------------------
    // mintLimit: the allowlist phase allows one per wallet and this wallet used it.
    await expect(
      mintFromCandyMachine({
        supabase: minterClient,
        umi: minterUmi,
        collectionId,
        collectionAddress: deployed.collectionAddress,
        candyMachineAddress: deployed.candyMachineAddress,
        creatorWallet,
        allowlist: [minterWallet],
        phase: { ...phases[0], groupLabel: phaseGroupLabel(0) },
      })
    ).rejects.toThrow(/limit/i);

    // allowList: the creator's wallet is not on it.
    await expect(
      mintFromCandyMachine({
        supabase: creatorClient,
        umi: creatorUmi,
        collectionId,
        collectionAddress: deployed.collectionAddress,
        candyMachineAddress: deployed.candyMachineAddress,
        creatorWallet,
        allowlist: [minterWallet],
        phase: { ...phases[0], groupLabel: phaseGroupLabel(0) },
      })
    ).rejects.toThrow(/proof|allow/i);

    console.log(
      `\n  ✓ drop ${collectionId} · machine ${deployed.candyMachineAddress} · 2 of ${SUPPLY} minted, guards enforcing\n`
    );
  },
  15 * 60_000
);

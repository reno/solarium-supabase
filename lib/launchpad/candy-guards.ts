import {
  MAX_NAME_LENGTH,
  MAX_URI_LENGTH,
  type DefaultGuardSetArgs,
} from "@metaplex-foundation/mpl-core-candy-machine";
import { createAmount, dateTime, publicKey, some } from "@metaplex-foundation/umi";

// Translation layer between a Solarium mint phase and a Metaplex candy guard group. Everything
// here is pure — no chain, no network — so the mapping that decides what a drop actually enforces
// is unit-testable, and the deploy/mint code below it only has to move bytes around.

/** A phase, as the launchpad stores it. */
export type PhaseInput = {
  id: string;
  name: string;
  priceLamports: bigint;
  startsAt: string;
  endsAt: string | null;
  perWalletLimit: number | null;
  allowlistOnly: boolean;
  position: number;
};

/** Marketplace fee, added on top of the mint price — same 2.0% the settle function charges. */
export const FEE_BPS = 200n;

export function feeOf(price: bigint): bigint {
  return (price * FEE_BPS) / 10000n;
}

// Candy guard labels are a fixed 6 bytes on chain, so a phase's own name can't be the label.
// Phases get "p<index>" by sorted position, and the index is recoverable from the label — the
// mint needs it to derive the same mintLimit id the deploy used.
export const MAX_PHASES = 200;

export function phaseGroupLabel(index: number): string {
  if (index < 0 || index >= MAX_PHASES) {
    throw new Error(`A drop supports at most ${MAX_PHASES} phases.`);
  }
  return `p${index}`;
}

export function phaseIndexFromLabel(label: string): number {
  const index = /^p(\d+)$/.exec(label);
  if (!index) throw new Error(`Not a phase group label: ${label}`);
  return Number(index[1]);
}

/**
 * mintLimit counters are keyed by a u8 id, per candy machine. Giving each phase its own id keeps
 * their limits independent — minting out the allowlist phase must not consume the public
 * allowance. Ids start at 1 so a phase never uses 0, which reads as "unset".
 */
export function mintLimitId(index: number): number {
  return index + 1;
}

/** Sort phases the way the drop runs them, so labels/ids are stable across deploys. */
export function orderPhases(phases: PhaseInput[]): PhaseInput[] {
  return [...phases].sort(
    (a, b) => a.position - b.position || new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );
}

/**
 * Config lines store a name as a shared prefix plus a per-item suffix, and the program allocates
 * `nameLength` bytes for that suffix on every item — so the prefix is truncated (not the number)
 * to keep prefix + suffix inside the on-chain 32-byte name.
 */
export function nameSettings(
  collectionName: string,
  supply: number
): { prefixName: string; nameLength: number } {
  const nameLength = String(supply).length;
  const suffix = " #";
  const room = MAX_NAME_LENGTH - nameLength - suffix.length;
  if (room < 1) throw new Error("Supply is too large to number items on chain.");
  return { prefixName: `${collectionName.slice(0, room).trim()}${suffix}`, nameLength };
}

/** Per-item metadata lives at `<prefix>/<n>.json`, so the suffix is only ever a number + ".json". */
export function uriSettings(prefixUri: string, supply: number): { prefixUri: string; uriLength: number } {
  const uriLength = String(supply).length + ".json".length;
  if (prefixUri.length + uriLength > MAX_URI_LENGTH) {
    throw new Error("Metadata URL is too long for a candy machine config line.");
  }
  return { prefixUri, uriLength };
}

/** The variable halves of item `n`'s config line (1-based), to go with the settings above. */
export function configLineFor(n: number): { name: string; uri: string } {
  return { name: String(n), uri: `${n}.json` };
}

/**
 * Which item a minted asset turned out to be. Items are handed out in random order (the whole
 * point of `isSequential: false`), so the number only exists on the asset the chain produced.
 */
export function itemNumberFromName(name: string): number | null {
  const match = /#\s*(\d+)\s*$/.exec(name);
  return match ? Number(match[1]) : null;
}

export type GuardContext = {
  /** Where mint proceeds go — the creator. */
  creatorWallet: string;
  /** Where the marketplace fee goes — the settlement authority, same as secondary sales. */
  treasuryWallet: string | null;
  /** Root of the collection's allowlist, required for allowlist-only phases. */
  merkleRoot: Uint8Array | null;
};

/**
 * A phase's guards. Every rule the launchpad used to police in the page body becomes one of
 * these, and the chain refuses the mint instead of the button being disabled:
 *
 *   price            → solPayment  (paid to the creator)
 *   marketplace fee  → solFixedFee (paid to the treasury; per group, since it scales with price)
 *   starts_at        → startDate
 *   ends_at          → endDate
 *   per_wallet_limit → mintLimit   (a PDA counter per wallet, per id)
 *   allowlist_only   → allowList   (merkle root; the wallet proves membership before minting)
 */
export function guardsForPhase(
  phase: PhaseInput,
  index: number,
  ctx: GuardContext
): Partial<DefaultGuardSetArgs> {
  const guards: Partial<DefaultGuardSetArgs> = {
    startDate: some({ date: dateTime(new Date(phase.startsAt)) }),
  };
  if (phase.priceLamports > 0n) {
    guards.solPayment = some({
      lamports: createAmount(phase.priceLamports, "SOL", 9),
      destination: publicKey(ctx.creatorWallet),
    });
  }
  const fee = feeOf(phase.priceLamports);
  if (fee > 0n && ctx.treasuryWallet) {
    guards.solFixedFee = some({
      lamports: createAmount(fee, "SOL", 9),
      destination: publicKey(ctx.treasuryWallet),
    });
  }
  if (phase.endsAt) {
    guards.endDate = some({ date: dateTime(new Date(phase.endsAt)) });
  }
  if (phase.perWalletLimit != null) {
    guards.mintLimit = some({ id: mintLimitId(index), limit: phase.perWalletLimit });
  }
  if (phase.allowlistOnly) {
    if (!ctx.merkleRoot) {
      throw new Error(`Phase "${phase.name}" is allowlist-only but the allowlist is empty.`);
    }
    guards.allowList = some({ merkleRoot: ctx.merkleRoot });
  }
  return guards;
}

/** The full group set a candy guard is created (or re-synced) with. */
export function guardGroupsFor(
  phases: PhaseInput[],
  ctx: GuardContext
): { label: string; guards: Partial<DefaultGuardSetArgs> }[] {
  return orderPhases(phases).map((phase, index) => ({
    label: phaseGroupLabel(index),
    guards: guardsForPhase(phase, index, ctx),
  }));
}

import {
  MAX_NAME_LENGTH,
  MAX_URI_LENGTH,
  type DefaultGuardSetArgs,
} from "@metaplex-foundation/mpl-core-candy-machine";
import { createAmount, dateTime, publicKey, some } from "@metaplex-foundation/umi";
import { feeOf } from "@/supabase/functions/_shared/fee";

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

export const MAX_PHASES = 200;

// Guard labels are a fixed 6 bytes on chain, so a phase's name can't be the label.
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

// Ids start at 1 so a phase never uses 0, which the program reads as "unset".
export function mintLimitId(index: number): number {
  return index + 1;
}

export function orderPhases(phases: PhaseInput[]): PhaseInput[] {
  return [...phases].sort(
    (a, b) => a.position - b.position || new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );
}

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

export function uriSettings(prefixUri: string, supply: number): { prefixUri: string; uriLength: number } {
  const uriLength = String(supply).length + ".json".length;
  if (prefixUri.length + uriLength > MAX_URI_LENGTH) {
    throw new Error("Metadata URL is too long for a candy machine config line.");
  }
  return { prefixUri, uriLength };
}

export function configLineFor(n: number): { name: string; uri: string } {
  return { name: String(n), uri: `${n}.json` };
}

export function itemNumberFromName(name: string): number | null {
  const match = /#\s*(\d+)\s*$/.exec(name);
  return match ? Number(match[1]) : null;
}

export type GuardContext = {
  creatorWallet: string;
  treasuryWallet: string | null;
  merkleRoot: Uint8Array | null;
};

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
      throw new Error(
        `Phase "${phase.name}" is allowlist-only but the allowlist is empty. Add wallets under ` +
          `"Mint phases & allowlist" on this page, then deploy.`
      );
    }
    guards.allowList = some({ merkleRoot: ctx.merkleRoot });
  }
  return guards;
}

function hasEnded(phase: PhaseInput, nowMs: number): boolean {
  return phase.endsAt != null && new Date(phase.endsAt).getTime() <= nowMs;
}

export function guardGroupsFor(
  phases: PhaseInput[],
  ctx: GuardContext,
  nowMs: number = Date.now()
): { label: string; guards: Partial<DefaultGuardSetArgs> }[] {
  // Index is assigned before filtering: surviving phases keep their original index, because
  // mintLimit counters are PDAs keyed by an id derived from it. Renumbering silently resets
  // every wallet's count on the next guard sync.
  const groups = orderPhases(phases)
    .map((phase, index) => ({ phase, index }))
    .filter(({ phase }) => !hasEnded(phase, nowMs))
    .map(({ phase, index }) => ({
      label: phaseGroupLabel(index),
      guards: guardsForPhase(phase, index, ctx),
    }));
  if (groups.length === 0) {
    throw new Error("Every phase has already ended. Add a phase that is still open, then deploy.");
  }
  return groups;
}

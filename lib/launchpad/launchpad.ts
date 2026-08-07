import { lamportsToSol } from "@/lib/solana/lamports";

export type RawPhase = {
  id: string;
  name: string;
  price_lamports: string | number;
  starts_at: string;
  ends_at: string | null;
  per_wallet_limit: number | null;
  allowlist_only: boolean;
  position: number;
  /** The candy guard group this phase became, once the drop is deployed on chain. */
  group_label?: string | null;
};

export type PhaseStatus = "upcoming" | "live" | "ended";

export type Phase = {
  id: string;
  name: string;
  priceSol: string;
  priceLamports: bigint;
  startsAt: string;
  endsAt: string | null;
  perWalletLimit: number | null;
  allowlistOnly: boolean;
  groupLabel: string | null;
  status: PhaseStatus;
};

export type PhaseView = {
  phases: Phase[];
  /** The phase to feature: the live one, else the next upcoming, else the last ended. */
  active: Phase | null;
};

// Resolve each phase's status against the clock and pick the one to feature. Kept in lib
// so the Date.now() call stays out of any React server-component body (purity lint rule).
export function resolvePhases(raw: RawPhase[]): PhaseView {
  const now = Date.now();
  const phases: Phase[] = [...raw]
    .sort((a, b) => a.position - b.position || new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    .map((p) => {
      const start = new Date(p.starts_at).getTime();
      const end = p.ends_at ? new Date(p.ends_at).getTime() : null;
      const status: PhaseStatus = now < start ? "upcoming" : end !== null && now >= end ? "ended" : "live";
      return {
        id: p.id,
        name: p.name,
        priceSol: lamportsToSol(BigInt(String(p.price_lamports))),
        priceLamports: BigInt(String(p.price_lamports)),
        startsAt: p.starts_at,
        endsAt: p.ends_at,
        perWalletLimit: p.per_wallet_limit,
        allowlistOnly: p.allowlist_only,
        groupLabel: p.group_label ?? null,
        status,
      };
    });

  const live = phases.find((p) => p.status === "live") ?? null;
  const upcoming = phases.find((p) => p.status === "upcoming") ?? null;
  const lastEnded = [...phases].reverse().find((p) => p.status === "ended") ?? null;
  return { phases, active: live ?? upcoming ?? lastEnded };
}

/** Countdown target for the featured phase: when a live phase ends, or when an upcoming
 *  phase starts. Returns an ISO string or null (open-ended / nothing to count to). */
export function countdownTarget(active: Phase | null): { label: string; iso: string } | null {
  if (!active) return null;
  if (active.status === "live" && active.endsAt) return { label: "ends in", iso: active.endsAt };
  if (active.status === "upcoming") return { label: "starts in", iso: active.startsAt };
  return null;
}

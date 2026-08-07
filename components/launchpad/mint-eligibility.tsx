"use client";

import { useSelectedWalletAccount } from "@solana/react";

import { Icon } from "@/components/design";
import { useSolBalance } from "@/lib/solana/use-balance";

/**
 * The balance-sufficiency line of the launchpad eligibility check (D§5). Client-only because
 * it reads the connected wallet's live SOL balance and compares it to the mint price. The
 * sibling wallet/allowlist/editions lines are server-rendered on the launchpad detail page.
 */
export function BalanceEligibilityLine({ requiredSol }: { requiredSol: string }) {
  const [account] = useSelectedWalletAccount();
  const balance = useSolBalance(account?.address ?? null);
  const required = parseFloat(requiredSol);

  let ok = false;
  let label: string;
  if (!account) {
    label = "Connect wallet to check balance";
  } else if (balance === null) {
    label = "Checking balance…";
  } else {
    const bal = Number(balance) / 1e9;
    ok = !Number.isFinite(required) || bal >= required;
    label = ok ? "Balance sufficient" : `Need ${requiredSol} SOL · have ${bal.toFixed(2)}`;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
      <Icon name={ok ? "check-circle" : "x-circle"} size={14} color={ok ? "var(--price-up)" : "var(--text-tertiary)"} />
      <span style={{ fontSize: "var(--text-sm)", color: ok ? "var(--text-primary)" : "var(--text-tertiary)" }}>{label}</span>
    </div>
  );
}

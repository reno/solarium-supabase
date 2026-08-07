"use client";

import { useSelectedWalletAccount } from "@solana/react";
import { useConnect } from "@wallet-standard/react";
import type { UiWallet, UiWalletAccount } from "@wallet-standard/react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, Icon } from "@/components/design";
import { Avatar } from "@/components/profile/avatar";
import { accountSupportsSignIn, signInWithSolanaAccount } from "@/lib/auth/siws";
import { lamportsToSol } from "@/lib/solana/lamports";
import { useSolBalance } from "@/lib/solana/use-balance";
import { createClient } from "@/lib/supabase/client";

export type WalletMenuUser = {
  id: string;
  username: string | null;
  walletAddress: string | null;
  avatarUrl: string | null;
};

export function abbreviateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function solShort(lamports: bigint): string {
  const sol = Number(lamports) / 1e9;
  return sol.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function WalletMenu({ user, solUsd }: { user: WalletMenuUser | null; solUsd?: number }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setSelectedWalletAccount, wallets] = useSelectedWalletAccount();
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const balance = useSolBalance(user?.walletAddress ?? null);

  if (user) {
    const label =
      user.username ??
      (user.walletAddress ? abbreviateAddress(user.walletAddress) : "Account");
    const balanceSol = balance !== null ? Number(balance) / 1e9 : null;
    const menuLinks: Array<{ href: string; label: string; icon: string }> = [
      ...(user.username ? [{ href: `/u/${user.username}`, label: "Profile", icon: "user" as const }] : []),
      { href: "/collection", label: "Portfolio", icon: "wallet" },
      { href: "/collection?tab=activity", label: "Activity", icon: "activity" },
    ];
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
        {!user.username && (
          <Link
            href="/welcome"
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-md)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--accent)",
              textDecoration: "none",
            }}
          >
            Complete profile
          </Link>
        )}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-4)",
              height: "var(--control-h-md)",
              padding: "0 var(--space-4) 0 3px",
              background: "var(--surface-2)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-pill)",
              cursor: "pointer",
            }}
          >
            <Avatar username={user.username} avatarUrl={user.avatarUrl} size={22} />
            {balance !== null && (
              <span className="sol-num" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>
                {solShort(balance)} SOL
              </span>
            )}
            <span
              style={{
                fontFamily: user.username ? "var(--font-sans)" : "var(--font-mono)",
                fontSize: "var(--text-xs)",
                fontWeight: "var(--weight-semibold)",
                color: "var(--text-tertiary)",
              }}
            >
              {label}
            </span>
            <Icon name="chevron-down" size={13} />
          </button>
          {open && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={() => setOpen(false)} />
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 6px)",
                  zIndex: 80,
                  width: 232,
                  background: "var(--surface-overlay)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-card)",
                  boxShadow: "var(--shadow-overlay)",
                  padding: "var(--space-4)",
                }}
              >
                <div style={{ padding: "var(--space-5) var(--space-5) var(--space-6)", borderBottom: "1px solid var(--border-subtle)", marginBottom: "var(--space-4)" }}>
                  <div style={{ fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", color: "var(--text-tertiary)" }}>Balance</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-4)", marginTop: 2 }}>
                    <span className="sol-num" style={{ fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                      {balanceSol !== null ? `${lamportsToSol(balance!)} SOL` : "—"}
                    </span>
                    {balanceSol !== null && solUsd ? (
                      <span className="sol-num" style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                        ≈ ${Math.round(balanceSol * solUsd).toLocaleString("en-US")}
                      </span>
                    ) : null}
                  </div>
                </div>
                {menuLinks.map((l) => (
                  <Link
                    key={l.label}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-5)",
                      padding: "var(--space-5)",
                      borderRadius: "var(--radius-sm)",
                      textDecoration: "none",
                      color: "var(--text-body)",
                      fontSize: "var(--text-md)",
                    }}
                  >
                    <Icon name={l.icon} size={15} />
                    {l.label}
                  </Link>
                ))}
                <button
                  type="button"
                  onClick={async () => {
                    setOpen(false);
                    await supabase.auth.signOut();
                    setSelectedWalletAccount(undefined);
                    router.refresh();
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-5)",
                    width: "100%",
                    padding: "var(--space-5)",
                    marginTop: "var(--space-4)",
                    borderTop: "1px solid var(--border-subtle)",
                    borderLeft: "none",
                    borderRight: "none",
                    borderBottom: "none",
                    borderRadius: 0,
                    background: "transparent",
                    color: "var(--text-body)",
                    fontSize: "var(--text-md)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <Icon name="log-out" size={15} />
                  Disconnect
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <Button
        variant="primary"
        icon="wallet"
        onClick={() => {
          setError(null);
          setOpen((prev) => !prev);
        }}
      >
        Connect wallet
      </Button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 80,
            width: 256,
            background: "var(--surface-overlay)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-overlay)",
            padding: "var(--space-4)",
          }}
        >
          {wallets.length === 0 ? (
            <p
              style={{
                padding: "var(--space-5)",
                margin: 0,
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-md)",
                color: "var(--text-tertiary)",
              }}
            >
              No Solana wallets found. Install a wallet like Phantom or Solflare, then
              reload this page.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {wallets.map((wallet) => (
                <li key={wallet.name}>
                  <WalletOption
                    wallet={wallet}
                    onError={setError}
                    onSignedIn={(account, needsOnboarding) => {
                      setSelectedWalletAccount(account);
                      setOpen(false);
                      if (needsOnboarding) router.push("/welcome");
                      router.refresh();
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p
              style={{
                borderTop: "1px solid var(--border-subtle)",
                marginTop: "var(--space-4)",
                paddingTop: "var(--space-5)",
                marginBottom: 0,
                fontFamily: "var(--font-sans)",
                fontSize: "var(--text-md)",
                color: "var(--price-down)",
              }}
            >
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function WalletOption({
  wallet,
  onSignedIn,
  onError,
}: {
  wallet: UiWallet;
  onSignedIn: (account: UiWalletAccount, needsOnboarding: boolean) => void;
  onError: (message: string) => void;
}) {
  const [isConnecting, connect] = useConnect(wallet);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [hover, setHover] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  const busy = isConnecting || isSigningIn;

  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={busy}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-5)",
        width: "100%",
        padding: "var(--space-5)",
        background: hover ? "var(--surface-hover)" : "transparent",
        border: "none",
        borderRadius: "var(--radius-sm)",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.5 : 1,
        textAlign: "left",
        transition: "var(--transition-control)",
      }}
      onClick={async () => {
        setIsSigningIn(true);
        try {
          const accounts = await connect();
          const account = accounts.find(accountSupportsSignIn);
          if (!account) {
            onError(`${wallet.name} did not authorize a sign-in capable account.`);
            return;
          }
          const { needsOnboarding } = await signInWithSolanaAccount(supabase, account);
          onSignedIn(account, needsOnboarding);
        } catch (e) {
          onError(e instanceof Error ? e.message : "Failed to sign in.");
        } finally {
          setIsSigningIn(false);
        }
      }}
    >
      <Image src={wallet.icon} alt="" width={24} height={24} style={{ borderRadius: 4 }} unoptimized />
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "var(--text-md)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--text-primary)",
        }}
      >
        {wallet.name}
      </span>
      {busy && (
        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            color: "var(--text-tertiary)",
          }}
        >
          <Icon name="loader-circle" size={14} />
        </span>
      )}
    </button>
  );
}

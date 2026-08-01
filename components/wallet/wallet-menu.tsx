"use client";

import { useSelectedWalletAccount } from "@solana/react";
import { useConnect } from "@wallet-standard/react";
import type { UiWallet, UiWalletAccount } from "@wallet-standard/react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { accountSupportsSignIn, signInWithSolanaAccount } from "@/lib/auth/siws";
import { createClient } from "@/lib/supabase/client";

export type WalletMenuUser = {
  id: string;
  username: string | null;
  walletAddress: string | null;
};

export function abbreviateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function WalletMenu({ user }: { user: WalletMenuUser | null }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setSelectedWalletAccount, wallets] = useSelectedWalletAccount();
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  if (user) {
    const label =
      user.username ??
      (user.walletAddress ? abbreviateAddress(user.walletAddress) : "Account");
    return (
      <div className="flex items-center gap-3">
        {!user.username && (
          <Link
            href="/welcome"
            className="text-sm font-medium text-amber-600 underline-offset-4 hover:underline dark:text-amber-400"
          >
            Complete profile
          </Link>
        )}
        {user.username ? (
          <Link href={`/u/${user.username}`} className="text-sm font-medium underline-offset-4 hover:underline">
            {label}
          </Link>
        ) : (
          <span className="text-sm font-medium">{label}</span>
        )}
        <button
          className="rounded-full border border-zinc-300 px-4 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          onClick={async () => {
            await supabase.auth.signOut();
            setSelectedWalletAccount(undefined);
            router.refresh();
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-300"
        onClick={() => {
          setError(null);
          setOpen((prev) => !prev);
        }}
      >
        Connect Wallet
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          {wallets.length === 0 ? (
            <p className="p-3 text-sm text-zinc-500">
              No Solana wallets found. Install a wallet like Phantom or
              Solflare, then reload this page.
            </p>
          ) : (
            <ul>
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
            <p className="border-t border-zinc-200 p-3 text-sm text-red-600 dark:border-zinc-800 dark:text-red-400">
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
  const supabase = useMemo(() => createClient(), []);
  const busy = isConnecting || isSigningIn;

  return (
    <button
      className="flex w-full items-center gap-3 rounded-lg p-3 text-left text-sm transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-900"
      disabled={busy}
      onClick={async () => {
        setIsSigningIn(true);
        try {
          const accounts = await connect();
          const account = accounts.find(accountSupportsSignIn);
          if (!account) {
            onError(`${wallet.name} did not authorize a sign-in capable account.`);
            return;
          }
          const { needsOnboarding } = await signInWithSolanaAccount(
            supabase,
            account
          );
          onSignedIn(account, needsOnboarding);
        } catch (e) {
          onError(e instanceof Error ? e.message : "Failed to sign in.");
        } finally {
          setIsSigningIn(false);
        }
      }}
    >
      <Image
        src={wallet.icon}
        alt=""
        width={24}
        height={24}
        className="rounded"
        unoptimized
      />
      <span className="font-medium">{wallet.name}</span>
      {busy && <span className="ml-auto text-xs text-zinc-500">…</span>}
    </button>
  );
}

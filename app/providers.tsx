"use client";

import { SelectedWalletAccountContextProvider } from "@solana/react";
import type { UiWallet } from "@wallet-standard/react";

import { SOLANA_SIGN_IN_FEATURE } from "@/lib/auth/siws";

const SELECTED_WALLET_STORAGE_KEY = "solarium:selected-wallet";

function filterWallets(wallet: UiWallet): boolean {
  return (
    wallet.chains.some((chain) => chain.startsWith("solana:")) &&
    wallet.features.includes("standard:connect") &&
    wallet.features.includes(SOLANA_SIGN_IN_FEATURE)
  );
}

const stateSync = {
  getSelectedWallet: () =>
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(SELECTED_WALLET_STORAGE_KEY),
  storeSelectedWallet: (accountKey: string) => {
    window.localStorage.setItem(SELECTED_WALLET_STORAGE_KEY, accountKey);
  },
  deleteSelectedWallet: () => {
    window.localStorage.removeItem(SELECTED_WALLET_STORAGE_KEY);
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SelectedWalletAccountContextProvider
      filterWallets={filterWallets}
      stateSync={stateSync}
    >
      {children}
    </SelectedWalletAccountContextProvider>
  );
}

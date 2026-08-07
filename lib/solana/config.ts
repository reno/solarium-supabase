import { createSolanaRpc, type Rpc, type SolanaRpcApi } from "@solana/kit";

export type Cluster = "devnet" | "testnet" | "mainnet-beta" | "localnet";

export function getCluster(): Cluster {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  if (
    cluster !== "devnet" &&
    cluster !== "testnet" &&
    cluster !== "mainnet-beta" &&
    cluster !== "localnet"
  ) {
    throw new Error(`Unknown NEXT_PUBLIC_SOLANA_CLUSTER: ${cluster}`);
  }
  return cluster;
}

export function getRpcUrl(): string {
  const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SOLANA_RPC_URL is not set");
  return url;
}

export function getRpc(): Rpc<SolanaRpcApi> {
  return createSolanaRpc(getRpcUrl());
}

export function getSolanaChain(): `solana:${string}` {
  const cluster = getCluster();
  return cluster === "mainnet-beta" ? "solana:mainnet" : `solana:${cluster}`;
}

function explorerSuffix(): string {
  const cluster = getCluster();
  return cluster === "mainnet-beta" ? "" : cluster === "localnet" ? "?cluster=custom" : `?cluster=${cluster}`;
}

export function explorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}${explorerSuffix()}`;
}

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${explorerSuffix()}`;
}

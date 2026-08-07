"use client";

import { address } from "@solana/kit";
import { useEffect, useState } from "react";

import { getRpc } from "@/lib/solana/config";

export function useSolBalance(walletAddress: string | null): bigint | null {
  const [lamports, setLamports] = useState<bigint | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronous reset on null address
      setLamports(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rpc = getRpc();
        const { value } = await rpc.getBalance(address(walletAddress)).send();
        if (!cancelled) setLamports(BigInt(value));
      } catch {
        if (!cancelled) setLamports(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  return lamports;
}

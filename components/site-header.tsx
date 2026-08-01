import Link from "next/link";

import { WalletMenu, type WalletMenuUser } from "@/components/wallet/wallet-menu";
import { createClient } from "@/lib/supabase/server";

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let menuUser: WalletMenuUser | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, wallet_address")
      .eq("id", user.id)
      .maybeSingle();
    menuUser = {
      id: user.id,
      username: profile?.username ?? null,
      walletAddress: profile?.wallet_address ?? null,
    };
  }

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/80">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Solarium
          </Link>
          <nav className="flex items-center gap-6 text-sm text-zinc-600 dark:text-zinc-400">
            <Link href="/" className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50">
              Explore
            </Link>
            <Link href="/create" className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50">
              Create
            </Link>
            {menuUser && (
              <Link href="/collection" className="transition-colors hover:text-zinc-950 dark:hover:text-zinc-50">
                My NFTs
              </Link>
            )}
          </nav>
        </div>
        <WalletMenu user={menuUser} />
      </div>
    </header>
  );
}

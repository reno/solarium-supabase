import Image from "next/image";
import Link from "next/link";

import { MobileNav } from "@/components/mobile-nav";
import { GlobalSearch } from "@/components/search/global-search";
import { SiteNav } from "@/components/site-nav";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { WalletMenu, type WalletMenuUser } from "@/components/wallet/wallet-menu";
import { getSolUsd } from "@/lib/price/sol";
import { createClient } from "@/lib/supabase/server";

export async function SiteHeader() {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    solUsd,
  ] = await Promise.all([supabase.auth.getUser(), getSolUsd()]);

  let menuUser: WalletMenuUser | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, wallet_address, avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    menuUser = {
      id: user.id,
      username: profile?.username ?? null,
      walletAddress: profile?.wallet_address ?? null,
      avatarUrl: profile?.avatar_url ?? null,
    };
  }

  const links = [
    { href: "/", label: "Explore", icon: "compass" },
    { href: "/launchpad", label: "Launchpad", icon: "rocket" },
    ...(menuUser
      ? [
          { href: "/portfolio", label: "Portfolio", icon: "briefcase" },
          { href: "/creator", label: "Creator", icon: "palette" },
        ]
      : []),
  ];

  return (
    <>
    <header
      className="sol-header"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        height: "var(--nav-h)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-9)",
        padding: "0 var(--page-gutter)",
        borderBottom: "1px solid var(--border-subtle)",
        background: "color-mix(in oklab, var(--bg-page) 85%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <Link
        href="/"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-4)",
          textDecoration: "none",
        }}
      >
        <Image
          src="/logo.svg"
          alt="Solarium"
          width={35}
          height={40}
          priority
          unoptimized
          style={{ display: "block" }}
        />
        <span
          className="sol-hide-sm"
          style={{
            font: "var(--weight-bold) 16px/1 var(--font-sans)",
            letterSpacing: "0.08em",
            color: "var(--accent)",
          }}
        >
          SOLARIUM
        </span>
      </Link>
      <SiteNav links={links} className="sol-hide-sm" />
      <div className="sol-header-actions" style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", marginLeft: "auto" }}>
        <GlobalSearch />
        <div
          title="SOL / USD"
          className="sol-hide-sm"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-4)",
            height: "var(--control-h-md)",
            padding: "0 var(--space-5)",
            background: "var(--surface-2)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-pill)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "var(--radius-pill)",
              background: "var(--live)",
              animation: "sol-pulse 2s ease-in-out infinite",
            }}
          />
          <span style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-semibold)", letterSpacing: "0.04em", color: "var(--text-tertiary)" }}>SOL</span>
          <span className="sol-num" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>
            ${solUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <ThemeToggle />
        <WalletMenu user={menuUser} solUsd={solUsd} />
      </div>
    </header>
    <MobileNav links={links} />
    </>
  );
}

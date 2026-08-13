"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/design";

export type MobileNavLink = { href: string; label: string; icon: string };

export function MobileNav({ links }: { links: MobileNavLink[] }) {
  const pathname = usePathname();
  return (
    <nav
      className="sol-only-sm sol-mobile-nav"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 55,
        height: "var(--mobile-nav-h)",
        alignItems: "stretch",
        borderTop: "1px solid var(--border-subtle)",
        background: "color-mix(in oklab, var(--bg-page) 92%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {links.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              minWidth: 0,
              textDecoration: "none",
              color: active ? "var(--accent)" : "var(--text-tertiary)",
            }}
          >
            <Icon name={l.icon} size={18} />
            <span style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-semibold)", letterSpacing: "0.02em" }}>{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

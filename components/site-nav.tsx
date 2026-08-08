"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLink = { href: string; label: string };

export function SiteNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      {links.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 28,
              padding: "0 var(--space-6)",
              borderRadius: "var(--radius-control)",
              background: active ? "var(--surface-2)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-secondary)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--text-md)",
              fontWeight: "var(--weight-semibold)",
              textDecoration: "none",
            }}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

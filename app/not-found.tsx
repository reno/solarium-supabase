import type { Metadata } from "next";
import Link from "next/link";

import { Icon } from "@/components/design";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

const DESTINATIONS: Array<{ href: string; label: string; icon: string; hint: string }> = [
  { href: "/", label: "Explore", icon: "compass", hint: "Live listings across every collection" },
  { href: "/collections", label: "Collections", icon: "layout-grid", hint: "Every collection, by volume and floor" },
  { href: "/launchpad", label: "Launchpad", icon: "rocket", hint: "Phased mints from Solarium creators" },
];

export default function NotFound() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", width: "100%", flex: 1, padding: "var(--space-13) var(--page-gutter)" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--accent)" }}>404</span>
      <h1 style={{ font: "var(--type-h1)", letterSpacing: "var(--tracking-heading)", color: "var(--text-primary)", margin: "var(--space-4) 0 0" }}>
        This page isn&apos;t here.
      </h1>
      <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: "var(--space-5) 0 var(--space-10)", maxWidth: 520, textWrap: "pretty" }}>
        The item, collection or profile you were looking for doesn&apos;t exist — or it was moved.
        Try one of these instead.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        {DESTINATIONS.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-6)",
              padding: "var(--space-6) var(--space-7)",
              background: "var(--surface-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-card)",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <span>
              <span style={{ display: "block", fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                {d.label}
              </span>
              <span style={{ display: "block", fontSize: "var(--text-sm)", color: "var(--text-tertiary)", marginTop: 2 }}>{d.hint}</span>
            </span>
            <Icon name={d.icon} size={16} color="var(--text-tertiary)" />
          </Link>
        ))}
      </div>
    </main>
  );
}

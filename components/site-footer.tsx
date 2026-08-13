import Link from "next/link";

import { SITE_NAME } from "@/lib/seo/site";

const SECTIONS: Array<{ heading: string; links: Array<{ href: string; label: string }> }> = [
  {
    heading: "Market",
    links: [
      { href: "/", label: "Explore" },
      { href: "/collections", label: "Collections" },
      { href: "/launchpad", label: "Launchpad" },
    ],
  },
  {
    heading: "Create",
    links: [
      { href: "/launchpad/apply", label: "Launch a collection" },
      { href: "/creator", label: "Creator studio" },
    ],
  },
  {
    heading: "You",
    links: [
      { href: "/portfolio", label: "Portfolio" },
      { href: "/welcome", label: "Profile settings" },
    ],
  },
];

const LINK_STYLE: React.CSSProperties = {
  fontSize: "var(--text-md)",
  color: "var(--text-secondary)",
  textDecoration: "none",
};

export function SiteFooter() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border-subtle)",
        background: "var(--surface-1)",
        marginTop: "auto",
      }}
    >
      <div
        className="sol-cols-2"
        style={{
          maxWidth: "var(--page-max)",
          margin: "0 auto",
          width: "100%",
          display: "grid",
          gridTemplateColumns: "1.4fr repeat(3, minmax(0, 1fr))",
          gap: "var(--space-9)",
          padding: "var(--space-10) var(--page-gutter)",
        }}
      >
        <div>
          <span style={{ font: "var(--weight-bold) 16px/1 var(--font-sans)", letterSpacing: "0.08em", color: "var(--accent)" }}>
            SOLARIUM
          </span>
          <p style={{ font: "var(--type-body)", color: "var(--text-tertiary)", margin: "var(--space-5) 0 0", maxWidth: 320, textWrap: "pretty" }}>
            A Solana NFT marketplace and launchpad. Ownership and settlement happen on chain; every
            sale settles in a single transaction.
          </p>
        </div>
        {SECTIONS.map((section) => (
          <div key={section.heading}>
            <h2 className="sol-label" style={{ fontSize: "var(--text-2xs)", margin: 0 }}>
              {section.heading}
            </h2>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--space-4)", margin: "var(--space-5) 0 0", padding: 0 }}>
              {section.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} style={LINK_STYLE}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div
        style={{
          maxWidth: "var(--page-max)",
          margin: "0 auto",
          width: "100%",
          padding: "0 var(--page-gutter) var(--space-9)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-2xs)",
          color: "var(--text-tertiary)",
        }}
      >
        © {new Date().getFullYear()} {SITE_NAME}
      </div>
    </footer>
  );
}

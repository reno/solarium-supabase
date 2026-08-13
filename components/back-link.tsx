"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";

import { Icon } from "@/components/design";

const STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-4)",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 0,
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-md)",
  color: "var(--text-secondary)",
  textDecoration: "none",
  transition: "color var(--dur-fast) var(--ease-out)",
};

export function BackLink({ label = "Back", href }: { label?: string; href?: string }) {
  const router = useRouter();

  if (href) {
    return (
      <Link href={href} style={STYLE}>
        <Icon name="arrow-left" size={14} /> {label}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => router.back()} style={STYLE}>
      <Icon name="arrow-left" size={14} /> {label}
    </button>
  );
}

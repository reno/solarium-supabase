"use client";

import { useRouter } from "next/navigation";

import { Icon } from "@/components/design";

export function BackLink({ label = "Back" }: { label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      style={{
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
        transition: "color var(--dur-fast) var(--ease-out)",
      }}
    >
      <Icon name="arrow-left" size={14} /> {label}
    </button>
  );
}

"use client";

import { useRouter } from "next/navigation";

export function BackLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="text-sm text-zinc-500 transition-colors hover:text-zinc-950 dark:hover:text-zinc-50"
    >
      ← Back
    </button>
  );
}

"use client";

import { useMemo, useState } from "react";

import { likeNft, unlikeNft } from "@/lib/social/social";
import { createClient } from "@/lib/supabase/client";

export function LikeButton({
  nftId,
  viewerId,
  initialCount,
  initialLiked,
}: {
  nftId: string;
  viewerId: string | null;
  initialCount: number;
  initialLiked: boolean;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  if (!viewerId) {
    return (
      <span
        title="Sign in to like"
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
      >
        <span aria-hidden>❤</span>
        {count}
      </span>
    );
  }

  const toggle = async () => {
    if (busy) return;
    const nextLiked = !liked;
    setBusy(true);
    setLiked(nextLiked);
    setCount((c) => c + (nextLiked ? 1 : -1));
    try {
      if (nextLiked) {
        await likeNft(supabase, { nftId, userId: viewerId });
      } else {
        await unlikeNft(supabase, { nftId, userId: viewerId });
      }
    } catch {
      setLiked(!nextLiked);
      setCount((c) => c + (nextLiked ? -1 : 1));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={liked}
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 text-sm transition-colors hover:border-zinc-300 disabled:opacity-50 dark:border-zinc-800 dark:hover:border-zinc-700"
    >
      <span aria-hidden className={liked ? "text-red-500" : "text-zinc-500 dark:text-zinc-400"}>
        ❤
      </span>
      {count}
    </button>
  );
}

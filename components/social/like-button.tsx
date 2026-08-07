"use client";

import { useMemo, useState } from "react";

import { Icon } from "@/components/design";
import { likeNft, unlikeNft } from "@/lib/social/social";
import { createClient } from "@/lib/supabase/client";

const CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-4)",
  height: "var(--control-h-md)",
  padding: "0 var(--space-6)",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--border-default)",
  background: "var(--surface-2)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--text-md)",
  fontWeight: "var(--weight-semibold)",
  color: "var(--text-body)",
};

const COUNT: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
  fontSize: "var(--text-xs)",
};

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
      <span title="Sign in to like" style={{ ...CHIP, color: "var(--text-tertiary)", cursor: "default" }}>
        <Icon name="heart" size={15} />
        <span style={COUNT}>{count}</span>
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
      style={{
        ...CHIP,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
        color: liked ? "var(--price-down)" : "var(--text-body)",
        borderColor: liked ? "var(--price-down)" : "var(--border-default)",
        transition: "var(--transition-control)",
      }}
    >
      <Icon name="heart" size={15} />
      <span style={COUNT}>{count}</span>
    </button>
  );
}

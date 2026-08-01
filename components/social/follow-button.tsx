"use client";

import { useMemo, useState } from "react";

import { followProfile, unfollowProfile } from "@/lib/social/social";
import { createClient } from "@/lib/supabase/client";

export function FollowButton({
  profileId,
  viewerId,
  initialFollowing,
}: {
  profileId: string;
  viewerId: string | null;
  initialFollowing: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  if (!viewerId || viewerId === profileId) {
    return null;
  }

  const toggle = async () => {
    if (busy) return;
    const nextFollowing = !following;
    setBusy(true);
    setFollowing(nextFollowing);
    try {
      if (nextFollowing) {
        await followProfile(supabase, { followerId: viewerId, followeeId: profileId });
      } else {
        await unfollowProfile(supabase, { followerId: viewerId, followeeId: profileId });
      }
    } catch {
      setFollowing(!nextFollowing);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
      className={
        following
          ? "rounded-full border border-zinc-300 px-4 py-1.5 text-sm transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          : "rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-300"
      }
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}

"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/design";
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
    <Button
      type="button"
      variant={following ? "secondary" : "primary"}
      icon={following ? "check" : "user-plus"}
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
    >
      {following ? "Following" : "Follow"}
    </Button>
  );
}

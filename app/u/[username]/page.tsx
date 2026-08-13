import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { ArtTile } from "@/components/design";
import { Avatar } from "@/components/profile/avatar";
import { EditableAvatar } from "@/components/profile/editable-avatar";
import { FollowButton } from "@/components/social/follow-button";
import { shortWallet } from "@/lib/format/wallet";
import { createClient } from "@/lib/supabase/server";

type ProfileSummary = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

function ProfileLink({ profile }: { profile: ProfileSummary }) {
  if (!profile.username) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
        <Avatar username={null} avatarUrl={profile.avatar_url} size={28} />
        {shortWallet(null)}
      </span>
    );
  }
  return (
    <Link href={`/u/${profile.username}`} style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", fontSize: "var(--text-md)", color: "var(--text-body)", textDecoration: "none" }}>
      <Avatar username={profile.username} avatarUrl={profile.avatar_url} size={28} />
      @{profile.username}
    </Link>
  );
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, bio, avatar_url, wallet_address")
    .eq("username", username)
    .maybeSingle();

  if (!profile) notFound();

  const [
    countsResult,
    viewerFollowsResult,
    followersResult,
    followingResult,
    nftsResult,
  ] = await Promise.all([
    supabase
      .from("profile_follow_counts")
      .select("follower_count, following_count")
      .eq("profile_id", profile.id)
      .maybeSingle(),
    user
      ? supabase
          .from("follows")
          .select("follower_id")
          .eq("follower_id", user.id)
          .eq("followee_id", profile.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("follows")
      .select("follower:profiles!follows_follower_id_fkey(id, username, avatar_url)")
      .eq("followee_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("follows")
      .select("followee:profiles!follows_followee_id_fkey(id, username, avatar_url)")
      .eq("follower_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("nfts")
      .select("id, name, image_url")
      .eq("owner_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const followerCount = countsResult.data?.follower_count ?? 0;
  const followingCount = countsResult.data?.following_count ?? 0;
  const viewerIsFollowing = Boolean(viewerFollowsResult.data);

  const followers: ProfileSummary[] = (followersResult.data ?? []).flatMap((row) => {
    const p = Array.isArray(row.follower) ? row.follower[0] : row.follower;
    return p ? [p] : [];
  });
  const following: ProfileSummary[] = (followingResult.data ?? []).flatMap((row) => {
    const p = Array.isArray(row.followee) ? row.followee[0] : row.followee;
    return p ? [p] : [];
  });
  const nfts = nftsResult.data ?? [];

  return (
    <main style={{ maxWidth: "var(--page-max)", margin: "0 auto", width: "100%", flex: 1, padding: "var(--space-11) var(--page-gutter) var(--space-13)" }}>
      <div style={{ marginBottom: "var(--space-8)" }}>
        <BackLink />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-7)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-7)" }}>
          <EditableAvatar
            userId={profile.id}
            username={profile.username}
            avatarUrl={profile.avatar_url}
            size={72}
            editable={user?.id === profile.id}
          />
          <div>
            <h1 style={{ font: "var(--type-h1)", letterSpacing: "var(--tracking-heading)", color: "var(--text-primary)", margin: 0 }}>@{profile.username}</h1>
            <p style={{ margin: "var(--space-3) 0 0", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{shortWallet(profile.wallet_address)}</p>
          </div>
        </div>
        <FollowButton profileId={profile.id} viewerId={user?.id ?? null} initialFollowing={viewerIsFollowing} />
      </div>

      {profile.bio && <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: "var(--space-7) 0 0", maxWidth: 640, textWrap: "pretty" }}>{profile.bio}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "var(--space-10)", marginTop: "var(--space-11)" }}>
        {([["Followers", followerCount, followers, "No followers yet."], ["Following", followingCount, following, "Not following anyone yet."]] as const).map(
          ([title, count, list, empty]) => (
            <section key={title}>
              <h2 className="sol-label" style={{ margin: "0 0 var(--space-6)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>
                {title} ({count})
              </h2>
              {list.length === 0 ? (
                <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>{empty}</p>
              ) : (
                <ul style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)", margin: 0, padding: 0, listStyle: "none" }}>
                  {list.map((p) => (
                    <li key={p.id}>
                      <ProfileLink profile={p} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        )}
      </div>

      <section style={{ marginTop: "var(--space-13)", paddingTop: "var(--space-10)", borderTop: "1px solid var(--border-subtle)" }}>
        <h2 className="sol-label" style={{ margin: "0 0 var(--space-7)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>NFTs</h2>
        {nfts.length === 0 ? (
          <p style={{ margin: 0, padding: "var(--space-8)", borderRadius: "var(--radius-card)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>Nothing owned yet.</p>
        ) : (
          <div className="sol-cards" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "var(--grid-gap)" }}>
            {nfts.map((nft) => (
              <Link key={nft.id} href={`/nft/${nft.id}`} style={{ display: "block", textDecoration: "none", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)", overflow: "hidden" }}>
                <div style={{ padding: "var(--space-4)", paddingBottom: 0 }}>
                  <ArtTile src={nft.image_url} label={nft.name} />
                </div>
                <div style={{ padding: "var(--space-5)" }}>
                  <p style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nft.name}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

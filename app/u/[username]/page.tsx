import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { FollowButton } from "@/components/social/follow-button";
import { createClient } from "@/lib/supabase/server";

function shortWallet(address: string | null | undefined): string {
  if (!address) return "unknown";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

type ProfileSummary = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

function Avatar({
  username,
  avatarUrl,
  size,
}: {
  username: string | null;
  avatarUrl: string | null;
  size: number;
}) {
  if (avatarUrl) {
    return (
      <div
        className="relative shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"
        style={{ width: size, height: size }}
      >
        <Image src={avatarUrl} alt={username ?? "avatar"} fill sizes={`${size}px`} className="object-cover" unoptimized />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      style={{ width: size, height: size, fontSize: size / 2.5 }}
    >
      {(username ?? "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

function ProfileLink({ profile }: { profile: ProfileSummary }) {
  if (!profile.username) {
    return (
      <span className="flex items-center gap-2 text-sm text-zinc-500">
        <Avatar username={null} avatarUrl={profile.avatar_url} size={28} />
        {shortWallet(null)}
      </span>
    );
  }
  return (
    <Link
      href={`/u/${profile.username}`}
      className="flex items-center gap-2 text-sm underline-offset-4 hover:underline"
    >
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
      .select("id, name, image_url, edition_number, edition_total")
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
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <div className="mb-6">
        <BackLink />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar username={profile.username} avatarUrl={profile.avatar_url} size={72} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">@{profile.username}</h1>
            <p className="mt-1 font-mono text-xs text-zinc-500">
              {shortWallet(profile.wallet_address)}
            </p>
          </div>
        </div>
        <FollowButton
          profileId={profile.id}
          viewerId={user?.id ?? null}
          initialFollowing={viewerIsFollowing}
        />
      </div>

      {profile.bio && (
        <p className="mt-6 text-zinc-600 dark:text-zinc-400">{profile.bio}</p>
      )}

      <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2">
        <section>
          <h2 className="mb-4 text-sm font-semibold tracking-tight text-zinc-500">
            Followers ({followerCount})
          </h2>
          {followers.length === 0 ? (
            <p className="text-sm text-zinc-500">No followers yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {followers.map((follower) => (
                <li key={follower.id}>
                  <ProfileLink profile={follower} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-sm font-semibold tracking-tight text-zinc-500">
            Following ({followingCount})
          </h2>
          {following.length === 0 ? (
            <p className="text-sm text-zinc-500">Not following anyone yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {following.map((followee) => (
                <li key={followee.id}>
                  <ProfileLink profile={followee} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-16 border-t border-zinc-200 pt-10 dark:border-zinc-800">
        <h2 className="mb-6 text-lg font-semibold tracking-tight">NFTs</h2>
        {nfts.length === 0 ? (
          <p className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800">
            Nothing owned yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
            {nfts.map((nft) => (
              <Link
                key={nft.id}
                href={`/nft/${nft.id}`}
                className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
              >
                <div className="relative aspect-square bg-zinc-100 dark:bg-zinc-900">
                  <Image
                    src={nft.image_url}
                    alt={nft.name}
                    fill
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                    className="object-cover"
                    unoptimized
                  />
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-medium">{nft.name}</p>
                  {nft.edition_total ? (
                    <p className="text-xs text-zinc-500">
                      #{nft.edition_number}/{nft.edition_total}
                    </p>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

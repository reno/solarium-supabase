import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { BuyButton } from "@/components/listings/buy-button";
import { OwnedNftControls } from "@/components/listings/my-nft-card";
import { CommentsSection, type CommentEntry } from "@/components/social/comments-section";
import {
  CommentsToggleButton,
  CommentsVisibilityGate,
  CommentsVisibilityProvider,
} from "@/components/social/comments-visibility";
import { LikeButton } from "@/components/social/like-button";
import { explorerAddressUrl } from "@/lib/solana/config";
import { lamportsToSol } from "@/lib/solana/lamports";
import { createClient } from "@/lib/supabase/server";

function shortWallet(address: string | null | undefined): string {
  if (!address) return "unknown";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export default async function NftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: row } = await supabase
    .from("nfts")
    .select(
      "id, name, description, image_url, asset_address, edition_number, edition_total, collection_id, owner_id, collections(name, collection_address), creator:profiles!nfts_creator_id_fkey(username, wallet_address), owner:profiles!nfts_owner_id_fkey(username, wallet_address), listings(id, price_lamports, status, seller_id)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!row) notFound();

  const collection = Array.isArray(row.collections)
    ? row.collections[0]
    : row.collections;
  const creator = Array.isArray(row.creator) ? row.creator[0] : row.creator;
  const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner;
  const activeListing = (row.listings ?? []).find(
    (listing: { status: string }) => listing.status === "active"
  );

  const isOwner = user?.id === row.owner_id;
  const priceSol = activeListing
    ? lamportsToSol(BigInt(String(activeListing.price_lamports)))
    : null;

  const [likeCountResult, viewerLikeResult, commentsResult, viewerProfileResult] =
    await Promise.all([
      supabase
        .from("nft_like_counts")
        .select("like_count")
        .eq("nft_id", id)
        .maybeSingle(),
      user
        ? supabase
            .from("likes")
            .select("nft_id")
            .eq("nft_id", id)
            .eq("profile_id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("comments")
        .select(
          "id, body, created_at, profile_id, profiles!comments_profile_id_fkey(username, wallet_address)"
        )
        .eq("nft_id", id)
        .order("created_at", { ascending: false }),
      user
        ? supabase
            .from("profiles")
            .select("username, wallet_address")
            .eq("id", user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const likeCount = likeCountResult.data?.like_count ?? 0;
  const viewerHasLiked = Boolean(viewerLikeResult.data);
  const comments: CommentEntry[] = (commentsResult.data ?? []).map((c) => {
    const author = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
    return {
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
      authorId: c.profile_id,
      authorName: author?.username ?? shortWallet(author?.wallet_address),
      authorUsername: author?.username ?? null,
    };
  });
  const viewerProfile = viewerProfileResult.data;
  const viewerName = viewerProfile
    ? viewerProfile.username ?? shortWallet(viewerProfile.wallet_address)
    : undefined;
  const viewerUsername = viewerProfile?.username ?? null;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <CommentsVisibilityProvider initialCount={comments.length}>
        <div className="mb-6">
          <BackLink />
        </div>
        <div className="grid gap-10 md:grid-cols-2">
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
            <Image
              src={row.image_url}
              alt={row.name}
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-contain"
              unoptimized
            />
          </div>
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {row.name}
              </h1>
              {collection && (
                <p className="mt-1 text-sm text-zinc-500">
                  Part of{" "}
                  <Link
                    href={`/series/${row.collection_id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {collection.name}
                  </Link>
                  {row.edition_total ? ` · #${row.edition_number}/${row.edition_total}` : ""}
                </p>
              )}
            </div>

            {row.description && (
              <p className="text-zinc-600 dark:text-zinc-400">
                {row.description}
              </p>
            )}

            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-zinc-500">Creator</dt>
                <dd>
                  {creator?.username ? (
                    <Link
                      href={`/u/${creator.username}`}
                      className="underline-offset-4 hover:underline"
                    >
                      @{creator.username}
                    </Link>
                  ) : (
                    shortWallet(creator?.wallet_address)
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Owner</dt>
                <dd>
                  {owner?.username ? (
                    <Link
                      href={`/u/${owner.username}`}
                      className="underline-offset-4 hover:underline"
                    >
                      @{owner.username}
                    </Link>
                  ) : (
                    shortWallet(owner?.wallet_address)
                  )}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-zinc-500">Asset</dt>
                <dd>
                  <a
                    className="font-mono text-xs underline-offset-4 hover:underline"
                    href={explorerAddressUrl(row.asset_address)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {row.asset_address}
                  </a>
                </dd>
              </div>
            </dl>

            <div className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
              {!isOwner && activeListing && (
                <p className="mb-3 text-xl font-medium">{priceSol} SOL</p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <LikeButton
                  nftId={row.id}
                  viewerId={user?.id ?? null}
                  initialCount={Number(likeCount)}
                  initialLiked={viewerHasLiked}
                />
                <CommentsToggleButton />
                {isOwner ? (
                  <OwnedNftControls
                    nft={{
                      id: row.id,
                      name: row.name,
                      imageUrl: row.image_url,
                      assetAddress: row.asset_address,
                      editionNumber: row.edition_number,
                      editionTotal: row.edition_total,
                      collectionId: row.collection_id,
                      collectionAddress: collection?.collection_address ?? null,
                      listing: activeListing
                        ? {
                            id: activeListing.id,
                            priceLamports: String(activeListing.price_lamports),
                          }
                        : null,
                    }}
                    userId={user!.id}
                  />
                ) : activeListing ? (
                  <BuyButton
                    listingId={activeListing.id}
                    sellerId={String(activeListing.seller_id)}
                    priceSol={priceSol!}
                    viewerId={user?.id ?? null}
                  />
                ) : (
                  <p className="text-sm text-zinc-500">Not for sale.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <CommentsVisibilityGate>
          <div className="mt-16 border-t border-zinc-200 pt-10 dark:border-zinc-800">
            <h2 className="mb-6 text-lg font-semibold tracking-tight">
              Comments
            </h2>
            <CommentsSection
              nftId={row.id}
              viewerId={user?.id ?? null}
              viewerName={viewerName}
              viewerUsername={viewerUsername}
              initialComments={comments}
            />
          </div>
        </CommentsVisibilityGate>
      </CommentsVisibilityProvider>
    </main>
  );
}

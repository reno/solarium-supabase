import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import {
  SeriesCarousel,
  type SeriesEdition,
} from "@/components/listings/series-carousel";
import { createClient } from "@/lib/supabase/server";

function shortWallet(address: string | null | undefined): string {
  if (!address) return "unknown";
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: collection } = await supabase
    .from("collections")
    .select(
      "id, name, description, cover_url, collection_address, creator:profiles!collections_creator_id_fkey(username, wallet_address)"
    )
    .eq("id", id)
    .maybeSingle();

  if (!collection) notFound();

  const creator = Array.isArray(collection.creator)
    ? collection.creator[0]
    : collection.creator;

  const { data: nftRows } = await supabase
    .from("nfts")
    .select(
      "id, name, image_url, asset_address, edition_number, edition_total, owner_id, listings(id, price_lamports, status, seller_id), owner:profiles!nfts_owner_id_fkey(username, wallet_address)"
    )
    .eq("collection_id", id)
    .order("edition_number", { ascending: true });

  const editions: SeriesEdition[] = (nftRows ?? []).map((row) => {
    const activeListing = (row.listings ?? []).find(
      (listing: { status: string }) => listing.status === "active"
    );
    const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner;
    return {
      id: row.id,
      name: row.name,
      imageUrl: row.image_url,
      assetAddress: row.asset_address,
      editionNumber: row.edition_number,
      editionTotal: row.edition_total,
      collectionId: id,
      collectionAddress: collection.collection_address ?? null,
      listing: activeListing
        ? {
            id: activeListing.id,
            priceLamports: String(activeListing.price_lamports),
            sellerId: String(activeListing.seller_id),
          }
        : null,
      owner: owner
        ? { username: owner.username, walletAddress: owner.wallet_address }
        : null,
      isOwnedByViewer: user?.id === row.owner_id,
    };
  });

  const listedCount = editions.filter((edition) => edition.listing).length;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <div className="mb-6">
        <BackLink />
      </div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {collection.name}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {editions.length} editions · {listedCount} listed · by{" "}
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
        </p>
        {collection.description && (
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            {collection.description}
          </p>
        )}
      </div>

      <SeriesCarousel editions={editions} viewerId={user?.id ?? null} />
    </main>
  );
}

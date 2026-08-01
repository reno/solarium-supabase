import { redirect } from "next/navigation";

import { MyNftCard, type OwnedNft } from "@/components/listings/my-nft-card";
import {
  NftSeriesGroup,
  type NftSeries,
} from "@/components/listings/nft-series-group";
import { createClient } from "@/lib/supabase/server";

export default async function CollectionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: rows } = await supabase
    .from("nfts")
    .select(
      "id, name, image_url, asset_address, edition_number, edition_total, collection_id, collections(collection_address, name, cover_url), listings(id, price_lamports, status)"
    )
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  const nfts: OwnedNft[] = (rows ?? []).map((row) => {
    const collection = Array.isArray(row.collections)
      ? row.collections[0]
      : row.collections;
    const activeListing = (row.listings ?? []).find(
      (listing: { status: string }) => listing.status === "active"
    );
    return {
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
    };
  });

  // Group multi-edition mints under their collection; standalone (quantity 1)
  // mints have no collection_id and stay in the flat grid.
  const collectionMeta = new Map<string, { name: string; coverUrl: string }>();
  for (const row of rows ?? []) {
    if (!row.collection_id || collectionMeta.has(row.collection_id)) continue;
    const collection = Array.isArray(row.collections)
      ? row.collections[0]
      : row.collections;
    collectionMeta.set(row.collection_id, {
      name: collection?.name ?? row.name,
      coverUrl: collection?.cover_url ?? row.image_url,
    });
  }

  const seriesById = new Map<string, NftSeries>();
  const standalone: OwnedNft[] = [];
  for (const nft of nfts) {
    if (!nft.collectionId) {
      standalone.push(nft);
      continue;
    }
    const existing = seriesById.get(nft.collectionId);
    if (existing) {
      existing.nfts.push(nft);
    } else {
      const meta = collectionMeta.get(nft.collectionId);
      seriesById.set(nft.collectionId, {
        collectionId: nft.collectionId,
        name: meta?.name ?? nft.name,
        coverUrl: meta?.coverUrl ?? nft.imageUrl,
        editionTotal: nft.editionTotal ?? 1,
        nfts: [nft],
      });
    }
  }
  const seriesGroups = Array.from(seriesById.values());
  for (const series of seriesGroups) {
    series.nfts.sort((a, b) => (a.editionNumber ?? 0) - (b.editionNumber ?? 0));
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">My NFTs</h1>
      <p className="mt-2 mb-8 text-zinc-600 dark:text-zinc-400">
        Everything owned by your wallet. List an NFT to put it up for sale.
      </p>
      {nfts.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800">
          Nothing here yet — mint something on the Create page.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {seriesGroups.map((series) => (
            <NftSeriesGroup
              key={series.collectionId}
              series={series}
              userId={user.id}
            />
          ))}
          {standalone.map((nft) => (
            <MyNftCard key={nft.id} nft={nft} userId={user.id} />
          ))}
        </div>
      )}
    </main>
  );
}

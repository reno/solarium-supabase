import Image from "next/image";
import Link from "next/link";

import { BuyButton } from "@/components/listings/buy-button";
import { lamportsToSol } from "@/lib/solana/lamports";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: rows } = await supabase
    .from("listings")
    .select(
      "id, price_lamports, seller_id, nfts(id, name, image_url, edition_number, edition_total), seller:profiles!listings_seller_id_fkey(username, wallet_address)"
    )
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(12);

  const listings = (rows ?? []).flatMap((row) => {
    const nft = Array.isArray(row.nfts) ? row.nfts[0] : row.nfts;
    const seller = Array.isArray(row.seller) ? row.seller[0] : row.seller;
    if (!nft) return [];
    return [
      {
        id: row.id as string,
        nftId: nft.id as string,
        sellerId: String(row.seller_id),
        priceSol: lamportsToSol(BigInt(String(row.price_lamports))),
        name: nft.name as string,
        imageUrl: nft.image_url as string,
        sellerUsername: (seller?.username as string | undefined) ?? null,
        sellerName:
          seller?.username ??
          (seller?.wallet_address
            ? `${seller.wallet_address.slice(0, 4)}…${seller.wallet_address.slice(-4)}`
            : "unknown"),
      },
    ];
  });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-16">
      <section className="flex flex-col items-start gap-4">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">
          Mint, collect, and trade NFTs on Solana.
        </h1>
        <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          Connect your wallet to create NFTs, list them and follow the creators you love.
        </p>
      </section>

      <section className="mt-16">
        <h2 className="mb-6 text-lg font-medium">Latest listings</h2>
        {listings.length === 0 ? (
          <p className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800">
            Nothing for sale yet. Be the first — mint something and list it.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {listings.map((listing) => (
              <div
                key={listing.id}
                className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
              >
                <Link href={`/nft/${listing.nftId}`} className="flex flex-col">
                  <div className="relative aspect-square bg-zinc-100 dark:bg-zinc-900">
                    <Image
                      src={listing.imageUrl}
                      alt={listing.name}
                      fill
                      sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <div className="p-4 pb-0">
                    <h3 className="font-medium">{listing.name}</h3>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {listing.priceSol} SOL
                    </p>
                  </div>
                </Link>
                <div className="px-4 pt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {listing.sellerUsername ? (
                    <Link
                      href={`/u/${listing.sellerUsername}`}
                      className="underline-offset-4 hover:underline"
                    >
                      @{listing.sellerName}
                    </Link>
                  ) : (
                    <span>@{listing.sellerName}</span>
                  )}
                </div>
                <div className="p-4">
                  <BuyButton
                    listingId={listing.id}
                    sellerId={listing.sellerId}
                    priceSol={listing.priceSol}
                    viewerId={user?.id ?? null}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

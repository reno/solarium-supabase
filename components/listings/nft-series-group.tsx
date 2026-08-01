import { MyNftCard, type OwnedNft } from "@/components/listings/my-nft-card";

export type NftSeries = {
  collectionId: string;
  name: string;
  coverUrl: string;
  editionTotal: number;
  nfts: OwnedNft[];
};

const DECK_LAYERS = ["translate-x-3 translate-y-3", "translate-x-1.5 translate-y-1.5"];

export function NftSeriesGroup({
  series,
  userId,
}: {
  series: NftSeries;
  userId: string;
}) {
  // The deck "depletes" as editions get listed — the next unlisted one is
  // always the card on top, ready to act on.
  const frontNft =
    series.nfts.find((nft) => !nft.listing) ??
    series.nfts[series.nfts.length - 1];

  return (
    <div className="relative">
      {DECK_LAYERS.map((offset, i) => (
        <div
          key={i}
          aria-hidden
          className={`absolute inset-0 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${offset}`}
        />
      ))}
      <div className="relative">
        <MyNftCard
          nft={frontNft}
          userId={userId}
          href={`/series/${series.collectionId}`}
        />
      </div>
    </div>
  );
}

import { MyNftCard } from "@/components/listings/my-nft-card";

export type Holding = {
  id: string;
  name: string;
  imageUrl: string;
  assetAddress: string;
  collectionId: string | null;
  collectionAddress: string | null;
  listing: { id: string; priceLamports: string } | null;
  floorSol: string | null;
  royaltyBps: number;
};

export function PortfolioHoldings({ holdings, userId }: { holdings: Holding[]; userId: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "var(--grid-gap)" }}>
      {holdings.map((h) => (
        <MyNftCard
          key={h.id}
          nft={{
            id: h.id,
            name: h.name,
            imageUrl: h.imageUrl,
            assetAddress: h.assetAddress,
            collectionId: h.collectionId,
            collectionAddress: h.collectionAddress,
            listing: h.listing,
          }}
          userId={userId}
          floorSol={h.floorSol}
          royaltyBps={h.royaltyBps}
        />
      ))}
    </div>
  );
}

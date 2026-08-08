import { shortWallet } from "@/lib/format/wallet";
import { lamportsToSol } from "@/lib/solana/lamports";

type Profile = { username: string | null; wallet_address: string | null } | null | undefined;

export type RawOffer = {
  id: string;
  bidder_id: string;
  price_lamports: string | number;
  expires_at: string;
  status: string;
  bidder?: Profile | Profile[];
  accepted_tx?: string | null;
  nft_id?: string | null;
  nft?: OfferNft | OfferNft[] | null;
};

type OfferNft = {
  name?: string;
  owner_id?: string | null;
  listings?: { status: string }[] | null;
};

export type OfferEntry = {
  id: string;
  bidderId: string;
  bidderName: string;
  priceSol: string;
  expiresAt: string;
  status: "active" | "accepted";
  isCollection?: boolean;
  quantity?: number;
  nftId?: string | null;
  itemName?: string | null;
  acceptable?: boolean;
  bindNftId?: string | null;
  settled?: boolean;
};

export type RawCollectionOffer = {
  id: string;
  bidder_id: string;
  price_lamports: string | number;
  quantity: number;
  expires_at: string;
  status: string;
  bidder?: Profile | Profile[];
};

export function mapCollectionOffers(rows: RawCollectionOffer[]): OfferEntry[] {
  const now = Date.now();
  return rows
    .filter((o) => new Date(o.expires_at).getTime() > now)
    .map((o) => {
      const bidder = Array.isArray(o.bidder) ? o.bidder[0] : o.bidder;
      return {
        id: o.id,
        bidderId: String(o.bidder_id),
        bidderName: bidder?.username ?? shortWallet(bidder?.wallet_address),
        priceSol: lamportsToSol(BigInt(String(o.price_lamports))),
        expiresAt: o.expires_at,
        status: "active" as const,
        isCollection: true,
        quantity: o.quantity,
      };
    });
}

function isSettled(offer: RawOffer, nft: OfferNft | null | undefined): boolean {
  if (offer.accepted_tx) return true;
  if (nft?.owner_id && nft.owner_id === String(offer.bidder_id)) return true;
  const listings = nft?.listings ?? [];
  return listings.some((l) => l.status === "sold") && !listings.some((l) => l.status === "active");
}

export function mapOffers(rows: RawOffer[]): OfferEntry[] {
  const now = Date.now();
  return rows
    .filter((o) => o.status === "accepted" || new Date(o.expires_at).getTime() > now)
    .map((o) => {
      const bidder = Array.isArray(o.bidder) ? o.bidder[0] : o.bidder;
      const nft = Array.isArray(o.nft) ? o.nft[0] : o.nft;
      return {
        id: o.id,
        bidderId: String(o.bidder_id),
        bidderName: bidder?.username ?? shortWallet(bidder?.wallet_address),
        priceSol: lamportsToSol(BigInt(String(o.price_lamports))),
        expiresAt: o.expires_at,
        status: o.status === "accepted" ? "accepted" : "active",
        nftId: o.nft_id ?? null,
        itemName: nft?.name ?? null,
        settled: isSettled(o, nft),
      };
    });
}

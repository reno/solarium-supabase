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
  /** Set once the bidder's completion transaction lands. */
  accepted_tx?: string | null;
  /** Present when offers are listed across several items (a collection or drop page). */
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
  /** True for a collection offer (bid on any item) surfaced on an item page; accepting binds this item. */
  isCollection?: boolean;
  quantity?: number;
  /** Which item the offer targets, when the list spans more than one. */
  nftId?: string | null;
  itemName?: string | null;
  /** Whether this viewer may accept this particular offer. Falls back to the list-wide `isOwner`
   *  on an item page, where every row targets the same item. */
  acceptable?: boolean;
  /** For a collection offer: the item to bind on accept. Needed when a list spans collections
   *  (the portfolio), where one list-wide item can't serve every row. */
  bindNftId?: string | null;
  /** The item already changed hands, so there is nothing left to complete — the row shows the
   *  outcome instead of an action. */
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

// Collection offers (bid on any item) surfaced on an item page as accept-able entries. Filters
// out expired ones; kept in lib so the Date.now() check stays out of any React render body.
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

/**
 * Whether the offer's item has already sold, in which case the row reports an outcome instead of
 * an action. Three ways to be sure, none of which show up in `offers.status` — an accepted offer
 * keeps that status forever, since completion writes `accepted_tx` rather than a new status:
 *
 *   1. the completion transaction landed;
 *   2. the bidder holds the item now (they may have simply bought the listing outright, which
 *      never touches their offer);
 *   3. the item has a sold listing and no active one — it changed hands and isn't back on sale,
 *      so there is nobody who could honour this bid.
 *
 * A sold listing *plus* a live one means the new owner relisted, and an active offer is still
 * good against them — so that case is deliberately not "sold".
 */
function isSettled(offer: RawOffer, nft: OfferNft | null | undefined): boolean {
  if (offer.accepted_tx) return true;
  if (nft?.owner_id && nft.owner_id === String(offer.bidder_id)) return true;
  const listings = nft?.listings ?? [];
  return listings.some((l) => l.status === "sold") && !listings.some((l) => l.status === "active");
}

// Offers worth showing on an item: active-but-not-expired plus any accepted (an accepted
// offer stays completable regardless of its original expiry). Highest price first is
// preserved from the query. Kept in lib so the Date.now() filter stays out of React render.
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

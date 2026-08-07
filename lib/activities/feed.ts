import { relativeTime } from "@/lib/format/relative-time";
import { isUnrevealed } from "@/lib/listings/active";
import { shortWallet } from "@/lib/format/wallet";
import { lamportsToSol } from "@/lib/solana/lamports";

type Profile = { username: string | null; wallet_address: string | null } | null | undefined;

export type RawActivity = {
  id: string;
  type: string;
  lamports: string | number | null;
  created_at: string;
  actor?: Profile | Profile[];
  counterparty?: Profile | Profile[];
  nft?: NftRef | NftRef[] | null;
};

type Reveal = { reveal_at: string | null };
type NftRef = {
  name: string | null;
  image_url?: string | null;
  collection?: Reveal | Reveal[] | null;
};

// Supabase embeds to-one relations as arrays.
function one<T>(x: T | T[] | null | undefined): T | null | undefined {
  return Array.isArray(x) ? x[0] : x;
}

export type FeedItem = {
  id: string;
  kind: "sale" | "list" | "mint" | "transfer" | "delist";
  item: string;
  image?: string;
  price: string;
  from: string;
  to: string;
  time: string;
};

const KIND: Record<string, FeedItem["kind"]> = {
  sale: "sale",
  list: "list",
  delist: "delist",
  mint: "mint",
  gift: "transfer",
};

function handle(p: Profile): string {
  return p?.username ? `@${p.username}` : shortWallet(p?.wallet_address);
}

export function toFeedItem(a: RawActivity, fallbackName = "", fallbackImage?: string | null): FeedItem {
  const kind = KIND[a.type] ?? "transfer";
  const nft = one(a.nft);
  const actor = one(a.actor);
  const counterparty = one(a.counterparty);
  const price = a.lamports != null ? lamportsToSol(BigInt(String(a.lamports))) : "—";
  let from = "—";
  let to = "—";
  if (a.type === "mint") {
    to = handle(actor);
  } else if (a.type === "list" || a.type === "delist") {
    from = handle(actor);
  } else if (a.type === "sale") {
    from = handle(counterparty);
    to = handle(actor);
  } else {
    from = handle(actor);
    to = handle(counterparty);
  }
  return {
    id: a.id,
    kind,
    item: nft?.name ?? fallbackName,
    image: isUnrevealed(one(nft?.collection)?.reveal_at)
      ? undefined
      : (nft?.image_url ?? fallbackImage ?? undefined),
    price,
    from,
    to,
    time: relativeTime(a.created_at),
  };
}

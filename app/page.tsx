import Link from "next/link";

import { ActivityRow, Button, Card } from "@/components/design";
import { FeaturedCarousel, type FeaturedItem } from "@/components/home/featured-carousel";
import { TrendingTable, type TrendingEntry } from "@/components/home/trending-table";
import { toFeedItem, type RawActivity } from "@/lib/activities/feed";
import { activeListing, isUnrevealed } from "@/lib/listings/active";
import { deltaBps, deltaLabel } from "@/lib/price/delta";
import { lamportsToSol } from "@/lib/solana/lamports";
import { createClient } from "@/lib/supabase/server";

type CollectionRow = {
  id: string;
  name: string;
  cover_url: string | null;
  creator_id: string;
  verified: boolean;
  stat_sparkline: number[] | null;
  created_at: string;
};
type NftRow = { id: string; collection_id: string | null; owner_id: string | null; listings: { price_lamports: string | number; status: string }[] | null };
/** How many slides the hero carousel shows, after collapsing each collection to one item. */
const FEATURED_SLIDES = 8;

type FeaturedCollection = { name: string; reveal_at: string | null };
type RecentListingNft = {
  id: string;
  name: string;
  image_url: string;
  collection_id: string | null;
  collection: FeaturedCollection | FeaturedCollection[] | null;
};
type RecentListingRow = {
  price_lamports: string | number;
  nft: RecentListingNft | RecentListingNft[] | null;
};

export default async function Home() {
  const supabase = await createClient();

  const [collectionsRes, nftsRes, recentListingsRes, activitiesRes, listingCountRes, salesRes, marketStatsRes] = await Promise.all([
    supabase.from("collections").select("id, name, cover_url, creator_id, verified, stat_sparkline, created_at"),
    supabase.from("nfts").select("id, collection_id, owner_id, listings(price_lamports, status)"),
    // Newest active listings drive the hero carousel. Over-fetch: one listing spree can put
    // dozens of rows from a single collection at the top, and the carousel keeps only one of
    // each, so the raw window has to be much wider than the number of slides.
    supabase
      .from("listings")
      .select("id, price_lamports, expires_at, status, nft:nfts(id, name, image_url, collection_id, collection:collections(name, reveal_at))")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("activities")
      .select("id, type, lamports, created_at, nft:nfts(name, image_url, collection:collections(reveal_at)), actor:profiles!activities_actor_id_fkey(username, wallet_address), counterparty:profiles!activities_counterparty_id_fkey(username, wallet_address)")
      .order("created_at", { ascending: false })
      .limit(7),
    supabase.from("listings").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("activities").select("lamports").eq("type", "sale"),
    supabase.from("collection_market_stats").select("collection_id, volume_all, volume_24h, volume_prev_24h, volume_7d, volume_30d, sales_count"),
  ]);

  type MarketStatsRow = {
    collection_id: string;
    volume_all: string | number;
    volume_24h: string | number;
    volume_prev_24h: string | number;
    volume_7d: string | number;
    volume_30d: string | number;
    sales_count: string | number;
  };

  // Everything windowed comes from this view, which is computed on read: the 24h/7d/30d volumes
  // behind the range select, the 24h delta (a sliding window, so it can't be cached), and `sales`
  // — the live "has this ever traded?" signal. `stat_sparkline` is the one cached piece, since a
  // day bucket only moves when a sale lands.
  const win = new Map<string, { v24: number; v7d: number; v30: number; volAll: bigint; sales: number; bps: number | null }>();
  for (const m of (marketStatsRes.data ?? []) as MarketStatsRow[]) {
    win.set(m.collection_id, {
      v24: Number(m.volume_24h) / 1e9,
      v7d: Number(m.volume_7d) / 1e9,
      v30: Number(m.volume_30d) / 1e9,
      volAll: BigInt(String(m.volume_all)),
      sales: Number(m.sales_count),
      bps: deltaBps(BigInt(String(m.volume_24h)), BigInt(String(m.volume_prev_24h))),
    });
  }

  const collections = (collectionsRes.data ?? []) as CollectionRow[];
  const nfts = (nftsRes.data ?? []) as NftRow[];

  // Per-collection aggregates from real nfts/listings.
  const agg = new Map<string, { floor: bigint | null; listed: number; total: number; owners: Set<string>; minted: number }>();
  for (const c of collections) agg.set(c.id, { floor: null, listed: 0, total: 0, owners: new Set(), minted: 0 });
  for (const n of nfts) {
    if (!n.collection_id) continue;
    const a = agg.get(n.collection_id);
    if (!a) continue;
    a.total += 1;
    if (n.owner_id) a.owners.add(n.owner_id);
    const activeL = (n.listings ?? []).find((l) => l.status === "active");
    if (activeL) {
      a.listed += 1;
      const p = BigInt(String(activeL.price_lamports));
      if (a.floor === null || p < a.floor) a.floor = p;
    }
  }
  const creatorById = new Map(collections.map((c) => [c.id, c.creator_id]));
  for (const n of nfts) {
    if (!n.collection_id) continue;
    const a = agg.get(n.collection_id);
    if (a && n.owner_id && n.owner_id !== creatorById.get(n.collection_id)) a.minted += 1;
  }

  const trending: TrendingEntry[] = [...collections]
    .sort((a, b) => Number((win.get(b.id)?.volAll ?? 0n) - (win.get(a.id)?.volAll ?? 0n)))
    .map((c, i) => {
      const a = agg.get(c.id)!;
      const w = win.get(c.id);
      // Never traded → there is no trend line to draw. Say so rather than rendering a zeroed
      // sparkline (a flat line reads as "priced and stable", which would be a lie). The delta
      // handles its own empty case: no volume in either window compares to nothing.
      const traded = (w?.sales ?? 0) > 0;
      return {
        collectionId: c.id,
        rank: i + 1,
        name: c.name,
        verified: c.verified,
        image: c.cover_url ?? undefined,
        floor: a.floor !== null ? `${lamportsToSol(a.floor)} SOL` : "—",
        delta: deltaLabel(w?.bps ?? null),
        listed: a.total ? `${((a.listed / a.total) * 100).toFixed(1)}%` : "—",
        owners: a.owners.size.toLocaleString("en-US"),
        series: traded && Array.isArray(c.stat_sparkline) ? c.stat_sparkline : [],
        vol24: w?.v24 ?? 0,
        vol7d: w?.v7d ?? 0,
        vol30: w?.v30 ?? 0,
        deltaBps: w?.bps ?? 0,
        createdAt: new Date(c.created_at).getTime(),
      };
    });

  // Hero carousel = the most recently listed items still on sale, at most one per collection so
  // a creator listing their whole supply can't take over every slide. Expired-but-not-swept
  // listings are filtered here (status alone isn't enough — see lib/listings/active), and
  // unrevealed collections are left out rather than spoiling their art on the front page.
  const seenCollections = new Set<string>();
  const featuredItems: FeaturedItem[] = (recentListingsRes.data ?? [])
    .filter((l) => activeListing([l as { status: string; expires_at?: string | null }]))
    .map((l) => {
      const row = l as unknown as RecentListingRow;
      const nft = Array.isArray(row.nft) ? row.nft[0] : row.nft;
      const coll = nft && (Array.isArray(nft.collection) ? nft.collection[0] : nft.collection);
      return { nft, coll, price: row.price_lamports };
    })
    .filter((x) => x.nft && !isUnrevealed(x.coll?.reveal_at))
    .filter(({ nft }) => {
      // Rows arrive newest-first, so the first one seen for a collection is its latest listing.
      // A standalone 1/1 has no collection and is keyed by itself — those never collapse.
      const key = nft!.collection_id ?? `nft:${nft!.id}`;
      if (seenCollections.has(key)) return false;
      seenCollections.add(key);
      return true;
    })
    .slice(0, FEATURED_SLIDES)
    .map(({ nft, coll, price }) => {
      // Availability of the whole collection, for the bar. A standalone 1/1 is its own set of one.
      const a = nft!.collection_id ? agg.get(nft!.collection_id) : undefined;
      return {
        nftId: nft!.id,
        itemName: nft!.name,
        imageUrl: nft!.image_url,
        collectionName: coll?.name ?? nft!.name,
        priceSol: lamportsToSol(BigInt(String(price))),
        listedCount: a?.listed ?? 1,
        totalCount: a?.total ?? 1,
      };
    });

  const feed = (activitiesRes.data ?? []).map((a) => toFeedItem(a as unknown as RawActivity));

  const volumeLamports = (salesRes.data ?? []).reduce((s, a) => s + BigInt(String(a.lamports ?? 0)), 0n);
  const heroStats: Array<[string, string]> = [
    ["Volume traded", `${lamportsToSol(volumeLamports)} SOL`],
    ["Active listings", `${listingCountRes.count ?? 0}`],
    ["Collections", `${collections.length}`],
  ];

  return (
    <main style={{ maxWidth: "var(--page-max)", margin: "0 auto", width: "100%", flex: 1, padding: "var(--space-11) var(--page-gutter) var(--space-13)" }}>
      {/* Column template matches the trending/activity grid below, so the carousel lines up with
          the Live activity column. */}
      <div style={{ display: "grid", gridTemplateColumns: "1.75fr 1fr", gap: "var(--space-9)", marginBottom: "var(--space-11)", alignItems: "start" }}>
        <div>
          <h1 style={{ font: "var(--type-display)", letterSpacing: "var(--tracking-display)", color: "var(--text-primary)", margin: 0, maxWidth: 800 }}>
            Trade Solana NFTs at the floor.
          </h1>
          <p style={{ font: "var(--type-body)", fontSize: "var(--text-lg)", color: "var(--text-secondary)", maxWidth: 520, marginTop: "var(--space-6)", textWrap: "pretty" }}>
            Live listings across every collection. Sweep the floor, place bids, and settle in one transaction.
          </p>
          <div style={{ display: "flex", gap: "var(--space-5)", marginTop: "var(--space-8)" }}>
            <Link href={trending[0] ? `/series/${trending[0].collectionId}` : "/launchpad"} style={{ textDecoration: "none" }}>
              <Button variant="primary" icon="zap">Start trading</Button>
            </Link>
            <Link href="/launchpad" style={{ textDecoration: "none" }}>
              <Button variant="secondary" icon="rocket">Launch a collection</Button>
            </Link>
          </div>
          <div style={{ display: "flex", gap: "var(--space-11)", marginTop: "var(--space-10)", flexWrap: "wrap" }}>
            {heroStats.map(([label, value]) => (
              <div key={label}>
                <div className="sol-label" style={{ fontSize: "var(--text-2xs)" }}>{label}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-xl)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", marginTop: 2 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        <FeaturedCarousel items={featuredItems} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.75fr 1fr", gap: "var(--space-9)", alignItems: "start" }}>
        <TrendingTable rows={trending} />
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", marginBottom: "var(--space-7)", height: 30 }}>
            <span style={{ font: "var(--type-label)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>Live activity</span>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--live)", boxShadow: "var(--glow-live)" }} />
          </div>
          <Card padding={0}>
            {feed.length === 0 ? (
              <p style={{ margin: 0, padding: "var(--space-8)", fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>No activity yet.</p>
            ) : (
              feed.map((f, i) => <ActivityRow key={f.id} {...f} compact style={i === feed.length - 1 ? { borderBottom: "none" } : undefined} />)
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}

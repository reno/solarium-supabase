import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { BackLink } from "@/components/back-link";
import { FloorChartCard } from "@/components/charts/floor-chart-card";
import { ArtTile, Badge, Button, Card, CollectionStatsBar, Icon, type TraitGroup } from "@/components/design";
import { CollectionBrowser, type BrowserItem } from "@/components/collections/collection-browser";
import { CollectionOfferButton } from "@/components/offers/collection-offer-button";
import { toFeedItem, type RawActivity } from "@/lib/activities/feed";
import { shortWallet } from "@/lib/format/wallet";
import { getSolUsd } from "@/lib/price/sol";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd, collectionPageJsonLd } from "@/lib/seo/json-ld";
import { pageMetadata, truncate } from "@/lib/seo/metadata";
import { lamportsToSol } from "@/lib/solana/lamports";
import { createClient } from "@/lib/supabase/server";

type NftRow = {
  id: string;
  name: string;
  image_url: string;
  item_number: number | null;
  owner_id: string | null;
  rarity_rank: number | null;
  rarity_total: number | null;
  traits: { trait: string; value: string }[] | null;
  listings: { id: string; price_lamports: string | number; status: string }[] | null;
};

export const loadCollection = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("collections")
    .select(
      "id, name, description, cover_url, banner_url, verified, royalty_bps, creator:profiles!collections_creator_id_fkey(username, wallet_address)"
    )
    .eq("id", id)
    .maybeSingle();
  return data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const collection = await loadCollection(id);
  if (!collection) return { title: "Collection not found", robots: { index: false } };

  return pageMetadata({
    title: collection.name,
    description: collection.description
      ? truncate(collection.description)
      : `${collection.name} — floor, listings and activity on Solarium.`,
    path: `/collections/${id}`,
    image: collection.banner_url ?? collection.cover_url,
    imageAlt: `${collection.name} artwork`,
  });
}

export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const collection = await loadCollection(id);
  if (!collection) notFound();

  const bannerUrl = collection.banner_url ?? collection.cover_url ?? undefined;
  
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const creator = Array.isArray(collection.creator) ? collection.creator[0] : collection.creator;

  const { data: nftRows } = await supabase
    .from("nfts")
    .select("id, name, image_url, item_number, owner_id, rarity_rank, rarity_total, traits, listings(id, price_lamports, status)")
    .eq("collection_id", id)
    .order("item_number", { ascending: true });
  const rows = (nftRows ?? []) as NftRow[];
  const nftIds = rows.map((r) => r.id);

  const [activityRes, offersCountRes, priceActsRes, topOfferRes, vol24hRes, vol7dRes, collectionOffersRes, collLevelOffersRes, machineRes] = await Promise.all([
    nftIds.length
      ? supabase
          .from("activities")
          .select("id, type, lamports, created_at, nft:nfts(name, image_url, collection:collections(reveal_at)), actor:profiles!activities_actor_id_fkey(username, wallet_address), counterparty:profiles!activities_counterparty_id_fkey(username, wallet_address)")
          .in("nft_id", nftIds)
          .order("created_at", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] }),
    nftIds.length
      ? supabase.from("offers").select("id", { count: "exact", head: true }).in("nft_id", nftIds).eq("status", "active")
      : Promise.resolve({ count: 0 }),
    nftIds.length
      ? supabase.from("activities").select("lamports, type, created_at").in("nft_id", nftIds).in("type", ["list", "sale"]).not("lamports", "is", null).order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    nftIds.length
      ? supabase.from("offers").select("price_lamports").in("nft_id", nftIds).eq("status", "active").order("price_lamports", { ascending: false }).limit(1)
      : Promise.resolve({ data: [] }),
    nftIds.length
      ? supabase.from("activities").select("lamports").in("nft_id", nftIds).eq("type", "sale").gte("created_at", oneDayAgo)
      : Promise.resolve({ data: [] }),
    nftIds.length
      ? supabase.from("activities").select("lamports").in("nft_id", nftIds).eq("type", "sale").gte("created_at", sevenDaysAgo)
      : Promise.resolve({ data: [] }),
    nftIds.length
      ? supabase
          .from("offers")
          .select("id, price_lamports, expires_at, created_at, nft_id, nft:nfts(name), bidder:profiles!offers_bidder_id_fkey(username, wallet_address)")
          .in("nft_id", nftIds)
          .eq("status", "active")
          .order("price_lamports", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    supabase
      .from("offers")
      .select("id, price_lamports, quantity, expires_at, created_at, bidder:profiles!offers_bidder_id_fkey(username, wallet_address)")
      .eq("collection_id", id)
      .eq("status", "active")
      .order("price_lamports", { ascending: false })
      .limit(20),
    supabase.from("candy_machines").select("items_available, items_redeemed").eq("collection_id", id).maybeSingle(),
  ]);

  const machine = machineRes.data as { items_available: number; items_redeemed: number } | null;
  const unminted = machine ? machine.items_available - machine.items_redeemed : 0;

  const items: BrowserItem[] = rows.map((row) => {
    const active = (row.listings ?? []).find((l) => l.status === "active");
    return {
      id: row.id,
      name: row.name,
      imageUrl: row.image_url,
      priceSol: active ? lamportsToSol(BigInt(String(active.price_lamports))) : null,
      listingId: active ? active.id : null,
      rank: row.rarity_rank,
      rarityTotal: row.rarity_total,
      traits: Array.isArray(row.traits) ? row.traits : [],
      listed: !!active,
      ownedByViewer: !!user && row.owner_id === user.id,
    };
  });

  const traitMap = new Map<string, Map<string, number>>();
  for (const e of items)
    for (const tr of e.traits) {
      if (!traitMap.has(tr.trait)) traitMap.set(tr.trait, new Map());
      const vm = traitMap.get(tr.trait)!;
      vm.set(tr.value, (vm.get(tr.value) ?? 0) + 1);
    }
  const traitGroups: TraitGroup[] = [...traitMap].map(([name, vm]) => ({
    name,
    values: [...vm].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
  }));

  const feed = ((activityRes.data ?? []) as unknown as RawActivity[]).map((a) => toFeedItem(a));

  type OfferRow = {
    id: string;
    price_lamports: string | number;
    expires_at: string;
    created_at: string;
    nft_id: string;
    nft: { name: string } | { name: string }[] | null;
    bidder: { username: string | null; wallet_address: string | null } | { username: string | null; wallet_address: string | null }[] | null;
  };
  
  type Bidder = { username: string | null; wallet_address: string | null };
  const itemOffers = (collectionOffersRes.data ?? [] as OfferRow[]).map((o) => {
    const nft = Array.isArray(o.nft) ? o.nft[0] : o.nft;
    const bidder = Array.isArray(o.bidder) ? o.bidder[0] : o.bidder;
    return {
      id: o.id,
      nftId: o.nft_id,
      nftName: nft?.name ?? "Unknown",
      priceSol: lamportsToSol(BigInt(String(o.price_lamports))),
      bidderName: bidder?.username ?? shortWallet(bidder?.wallet_address),
      bidderUsername: bidder?.username ?? null,
      expiresAt: o.expires_at,
      createdAt: o.created_at,
    };
  });
  const collLevelOffers = ((collLevelOffersRes.data ?? []) as { id: string; price_lamports: string | number; quantity: number; expires_at: string; created_at: string; bidder: Bidder | Bidder[] | null }[]).map((o) => {
    const bidder = Array.isArray(o.bidder) ? o.bidder[0] : o.bidder;
    return {
      id: o.id,
      nftId: null,
      nftName: `Any item · ×${o.quantity}`,
      priceSol: lamportsToSol(BigInt(String(o.price_lamports))),
      bidderName: bidder?.username ?? shortWallet(bidder?.wallet_address),
      bidderUsername: bidder?.username ?? null,
      expiresAt: o.expires_at,
      createdAt: o.created_at,
      isCollection: true,
    };
  });
  const collectionOffers = [...collLevelOffers, ...itemOffers];

  const activePrices = items.filter((e) => e.priceSol).map((e) => parseFloat(e.priceSol!));
  const floor = activePrices.length ? Math.min(...activePrices) : null;
  const listedCount = activePrices.length;
  const ownerCount = new Set(rows.map((r) => r.owner_id).filter(Boolean)).size;
  
  const topBidLamports = (topOfferRes.data && topOfferRes.data.length > 0) 
    ? BigInt(String(topOfferRes.data[0].price_lamports)) 
    : null;
  const topBid = topBidLamports ? parseFloat(lamportsToSol(topBidLamports)) : null;
  
  const vol24h = (vol24hRes.data ?? []).reduce((sum, a) => sum + Number(a.lamports ?? 0), 0) / 1e9;
  const vol7d = (vol7dRes.data ?? []).reduce((sum, a) => sum + Number(a.lamports ?? 0), 0) / 1e9;
  
  const stats = [
    { label: "Floor", value: floor != null ? `${floor} SOL` : "—" },
    { label: "Top bid", value: topBid != null ? `${topBid.toFixed(2)} SOL` : "—" },
    { label: "24h volume", value: vol24h > 0 ? `${vol24h.toFixed(1)} SOL` : "—" },
    { label: "7d volume", value: vol7d > 0 ? `${vol7d.toFixed(1)} SOL` : "—" },
    { label: "Listed", value: `${listedCount}`, sub: `of ${items.length}` },
    { label: "Owners", value: `${ownerCount}` },
    { label: "Royalty", value: `${((collection.royalty_bps ?? 0) / 100).toFixed(1)}%` },
  ];

  const priceSeries = ((priceActsRes.data ?? []) as { lamports: string | number }[]).map((a) => Number(a.lamports) / 1e9);
  const showHistory = new Set(priceSeries).size >= 2;
  const solUsd = await getSolUsd();

  return (
    <main style={{ width: "100%", flex: 1 }}>
      <JsonLd
        data={collectionPageJsonLd({
          name: collection.name,
          description: collection.description,
          path: `/collections/${collection.id}`,
          image: bannerUrl,
          items: items.slice(0, 20).map((item) => ({ name: item.name, path: `/nft/${item.id}` })),
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Collections", path: "/collections" },
          { name: collection.name, path: `/collections/${collection.id}` },
        ])}
      />
      <div style={{ position: "relative" }}>
        <ArtTile
          src={bannerUrl}
          label="collection banner · 6:1"
          alt={`${collection.name} banner`}
          ratio="6 / 1"
          radius="0"
          className="sol-banner"
          sizes="100vw"
          priority
          style={{ border: "none" }}
        />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, var(--bg-page), transparent 70%)" }} />
      </div>

      <div style={{ maxWidth: "var(--page-max)", margin: "0 auto", padding: "0 var(--page-gutter) var(--space-13)" }}>
        <div style={{ marginTop: "var(--space-6)" }}>
          <BackLink label="Collections" href="/collections" />
        </div>

        <div className="sol-wrap" style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-8)", marginTop: "var(--space-6)" }}>
          <ArtTile src={collection.cover_url ?? undefined} label="" alt="" sizes="92px" style={{ width: 92, height: 92, flex: "0 0 auto", border: "2px solid var(--bg-page)", borderRadius: "var(--radius-card)" }} />
          <div style={{ flex: 1, paddingBottom: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
              <h1 style={{ font: "var(--type-h1)", letterSpacing: "var(--tracking-heading)", color: "var(--text-primary)", margin: 0 }}>{collection.name}</h1>
              {collection.verified && <Icon name="badge-check" size={18} color="var(--accent-2)" />}
              <Badge tone="neutral" mono>{items.length} items</Badge>
            </div>
            <p style={{ margin: "var(--space-4) 0 0", fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>
              by{" "}
              {creator?.username ? (
                <Link href={`/u/${creator.username}`} style={{ color: "var(--text-link)" }}>@{creator.username}</Link>
              ) : (
                shortWallet(creator?.wallet_address)
              )}
            </p>
          </div>
          <div className="sol-full-sm sol-wrap" style={{ display: "flex", gap: "var(--space-4)", paddingBottom: "var(--space-4)", flex: "0 0 auto" }}>
            {unminted > 0 && (
              <Link href={`/launchpad/${id}`} style={{ textDecoration: "none" }}>
                <Button variant="primary" icon="sparkle">Mint an item</Button>
              </Link>
            )}
            <CollectionOfferButton collectionId={id} collectionName={collection.name} viewerId={user?.id ?? null} floorSol={floor != null ? String(floor) : null} />
          </div>
        </div>

        <div style={{ padding: "var(--space-8) 0", borderBottom: "1px solid var(--border-subtle)" }}>
          <CollectionStatsBar stats={stats} />
        </div>

        {collection.description && (
          <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", maxWidth: 640, margin: "var(--space-8) 0 0", textWrap: "pretty" }}>{collection.description}</p>
        )}

        {showHistory && (
          <Card padding="var(--space-7)" style={{ marginTop: "var(--space-9)", maxWidth: 520 }}>
            <FloorChartCard data={priceSeries} height={150} />
          </Card>
        )}

        {items.length === 0 ? (
          <p style={{ margin: "var(--space-9) 0 0", fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>No items in this collection.</p>
        ) : (
          <CollectionBrowser items={items} traitGroups={traitGroups} activity={feed} offersCount={(offersCountRes.count ?? 0) + collLevelOffers.length} collectionOffers={collectionOffers} collectionName={collection.name} royaltyBps={collection.royalty_bps ?? 0} solUsd={solUsd} />
        )}
      </div>
    </main>
  );
}

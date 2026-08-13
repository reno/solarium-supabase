import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { BackLink } from "@/components/back-link";
import { FloorChartCard } from "@/components/charts/floor-chart-card";
import { ActivityRow, AddressChip, ArtTile, Badge, Card, DepthChart, PriceDisplay, RarityBadge } from "@/components/design";
import { Countdown } from "@/components/launchpad/countdown";
import { TabPanels } from "@/components/tab-panels";
import { activeListing as findActiveListing, isUnrevealed } from "@/lib/listings/active";
import { orderBook } from "@/lib/viz/item-viz";
import { BuyButton } from "@/components/listings/buy-button";
import { OwnedNftControls } from "@/components/listings/my-nft-card";
import { BidButton } from "@/components/offers/bid-button";
import { OffersList } from "@/components/offers/offers-list";
import { mapCollectionOffers, mapOffers, type RawCollectionOffer } from "@/lib/offers/map";
import { getSolUsd } from "@/lib/price/sol";
import { toFeedItem, type RawActivity } from "@/lib/activities/feed";
import { serverNow } from "@/lib/format/relative-time";
import { shortWallet } from "@/lib/format/wallet";
import { explorerAddressUrl, getCluster } from "@/lib/solana/config";
import { lamportsToSol } from "@/lib/solana/lamports";
import { FEE_LABEL, feeOf } from "@/supabase/functions/_shared/fee";
import { JsonLd } from "@/components/seo/json-ld";
import { breadcrumbJsonLd, productJsonLd } from "@/lib/seo/json-ld";
import { pageMetadata, truncate } from "@/lib/seo/metadata";
import { createClient } from "@/lib/supabase/server";

const LABEL: React.CSSProperties = {
  font: "var(--type-label)",
  fontSize: "var(--text-2xs)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-label)",
  color: "var(--text-tertiary)",
};

export const loadNft = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("nfts")
    .select(
      "id, name, description, image_url, asset_address, item_number, collection_id, owner_id, rarity_rank, rarity_total, traits, collections(name, cover_url, collection_address, royalty_bps, reveal_at, creator_id), creator:profiles!nfts_creator_id_fkey(username, wallet_address), owner:profiles!nfts_owner_id_fkey(username, wallet_address), listings(id, price_lamports, status, seller_id, expires_at)"
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
  const row = await loadNft(id);
  if (!row) return { title: "Item not found", robots: { index: false } };

  const collection = Array.isArray(row.collections) ? row.collections[0] : row.collections;
  const unrevealed = isUnrevealed(collection?.reveal_at);
  const listing = findActiveListing(row.listings ?? []);
  const title = collection?.name ? `${row.name} — ${collection.name}` : row.name;

  const facts = [
    row.item_number != null && collection?.name
      ? `Item #${row.item_number} of ${collection.name}`
      : collection?.name
        ? `Part of ${collection.name}`
        : null,
    !unrevealed && row.rarity_rank != null
      ? `rarity rank ${row.rarity_rank}${row.rarity_total ? `/${row.rarity_total}` : ""}`
      : null,
    listing ? `listed for ${lamportsToSol(BigInt(String(listing.price_lamports)))} SOL` : "not listed",
  ].filter(Boolean);

  return pageMetadata({
    title,
    description: row.description ? truncate(row.description) : facts.join(" · "),
    path: `/nft/${id}`,
    image: unrevealed ? collection?.cover_url : row.image_url,
    imageAlt: unrevealed ? `${collection?.name ?? "Collection"} cover art` : row.name,
  });
}

export default async function NftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const row = await loadNft(id);

  if (!row) notFound();

  const collection = Array.isArray(row.collections) ? row.collections[0] : row.collections;
  const creator = Array.isArray(row.creator) ? row.creator[0] : row.creator;
  const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner;
  const activeListing = findActiveListing(row.listings ?? []);
  const unrevealed = isUnrevealed(collection?.reveal_at);
  const now = serverNow();

  const isOwner = user?.id === row.owner_id;
  const priceLamports = activeListing ? BigInt(String(activeListing.price_lamports)) : 0n;
  const priceSol = activeListing ? lamportsToSol(priceLamports) : null;
  const royaltyBps = collection?.royalty_bps ?? 0;
  const viewerIsCreator = !!user && collection?.creator_id === user.id;
  const sellerIsCreator =
    !!activeListing && !!collection?.creator_id && collection.creator_id === String(activeListing.seller_id);
  const chargedRoyaltyBps = viewerIsCreator || sellerIsCreator ? 0 : royaltyBps;
  const buyerTotalSol = activeListing
    ? lamportsToSol(priceLamports + (priceLamports * BigInt(chargedRoyaltyBps)) / 10000n + feeOf(priceLamports))
    : null;

  const [
    offersResult,
    activitiesResult,
    collListingsResult,
    collOffersResult,
    collLevelOffersResult,
  ] = await Promise.all([
      supabase
        .from("offers")
        .select("id, bidder_id, price_lamports, expires_at, status, accepted_tx, nft:nfts(owner_id, listings(status)), bidder:profiles!offers_bidder_id_fkey(username, wallet_address)")
        .eq("nft_id", id)
        .in("status", ["active", "accepted"])
        .order("price_lamports", { ascending: false }),
      supabase
        .from("activities")
        .select(
          "id, type, lamports, created_at, actor:profiles!activities_actor_id_fkey(username, wallet_address), counterparty:profiles!activities_counterparty_id_fkey(username, wallet_address)"
        )
        .eq("nft_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
      row.collection_id
        ? supabase.from("listings").select("price_lamports, nfts!inner(collection_id)").eq("status", "active").eq("nfts.collection_id", row.collection_id)
        : Promise.resolve({ data: [] }),
      row.collection_id
        ? supabase.from("offers").select("price_lamports, nfts!inner(collection_id)").eq("status", "active").eq("nfts.collection_id", row.collection_id)
        : Promise.resolve({ data: [] }),
      row.collection_id
        ? supabase.from("offers").select("id, bidder_id, price_lamports, quantity, expires_at, status, bidder:profiles!offers_bidder_id_fkey(username, wallet_address)").eq("collection_id", row.collection_id).eq("status", "active").order("price_lamports", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);

  const activities = (activitiesResult.data ?? []) as unknown as RawActivity[];
  const feed = activities.map((a) => toFeedItem(a, row.name, unrevealed ? null : row.image_url));

  const priceSeries = activities
    .filter((a) => (a.type === "list" || a.type === "sale") && a.lamports != null)
    .map((a) => ({ t: new Date(a.created_at).getTime(), v: Number(a.lamports) / 1e9 }))
    .sort((a, b) => a.t - b.t)
    .map((p) => p.v);
  const showHistory = new Set(priceSeries).size >= 2;

  const itemOffers = mapOffers(offersResult.data ?? []);
  const collectionOfferEntries = mapCollectionOffers((collLevelOffersResult.data ?? []) as unknown as RawCollectionOffer[]);
  const offers = [...collectionOfferEntries, ...itemOffers];
  const topBidSol = offers.find((o) => o.status === "active")?.priceSol;
  const lastSaleActivity = activities.find((a) => a.type === "sale" && a.lamports != null);
  const lastSaleSol = lastSaleActivity ? lamportsToSol(BigInt(String(lastSaleActivity.lamports))) : null;

  const traits: { trait: string; value: string }[] = Array.isArray(row.traits) ? row.traits : [];

  const toSol = (p: string | number) => Number(lamportsToSol(BigInt(String(p))));
  const askPrices = row.collection_id
    ? ((collListingsResult.data ?? []) as { price_lamports: string | number }[]).map((l) => toSol(l.price_lamports))
    : activeListing
      ? [toSol(activeListing.price_lamports)]
      : [];
  const bidPrices = row.collection_id
    ? ((collOffersResult.data ?? []) as { price_lamports: string | number }[]).map((o) => toSol(o.price_lamports))
    : offers.filter((o) => o.status === "active").map((o) => parseFloat(o.priceSol));
  const depth = orderBook(askPrices, bidPrices);
  const collectionFloorSol = askPrices.length ? String(Math.min(...askPrices)) : null;
  const solUsd = await getSolUsd();

  const details: Array<[string, React.ReactNode]> = [
    [
      "Creator",
      creator?.username ? (
        <Link href={`/u/${creator.username}`} style={{ color: "var(--text-link)" }}>
          @{creator.username}
        </Link>
      ) : (
        shortWallet(creator?.wallet_address)
      ),
    ],
    [
      "Asset",
      <a
        key="asset"
        href={explorerAddressUrl(row.asset_address)}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--text-link)" }}
      >
        {shortWallet(row.asset_address)}
      </a>,
    ],
    ["Token standard", "Metaplex Core"],
    ["Chain", `Solana · ${getCluster()}`],
    ...(collection ? ([["Creator royalty", `${(royaltyBps / 100).toFixed(1)}%`]] as Array<[string, React.ReactNode]>) : []),
    ...(row.item_number != null ? ([["Item number", `#${row.item_number}`]] as Array<[string, React.ReactNode]>) : []),
  ];

  return (
    <main style={{ maxWidth: "var(--page-max)", margin: "0 auto", width: "100%", flex: 1, padding: "var(--space-8) var(--page-gutter) var(--space-13)" }}>
      <JsonLd
        data={productJsonLd({
          name: row.name,
          description: row.description,
          path: `/nft/${row.id}`,
          image: unrevealed ? collection?.cover_url : row.image_url,
          collectionName: collection?.name,
          collectionPath: row.collection_id ? `/collections/${row.collection_id}` : null,
          traits: unrevealed ? [] : traits,
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Collections", path: "/collections" },
          ...(collection?.name && row.collection_id
            ? [{ name: collection.name, path: `/collections/${row.collection_id}` }]
            : []),
          { name: row.name, path: `/nft/${row.id}` },
        ])}
      />
      <div style={{ marginBottom: "var(--space-8)" }}>
        <BackLink label={collection?.name ?? "Back"} href={row.collection_id ? `/collections/${row.collection_id}` : undefined} />
      </div>

        <div className="sol-split" style={{ display: "grid", gridTemplateColumns: "minmax(340px, 1fr) 1.2fr", gap: "var(--space-10)", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <ArtTile
              src={unrevealed ? undefined : row.image_url}
              label={unrevealed ? "unrevealed" : row.name}
              alt={row.name}
              radius="var(--radius-card)"
              sizes="(max-width: 1023px) 100vw, 520px"
              priority
            >
              {unrevealed && collection?.reveal_at ? (
                <div style={{ position: "absolute", bottom: "var(--space-6)", left: 0, right: 0, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                  reveal in <Countdown target={collection.reveal_at} now={now} style={{ color: "var(--accent)" }} />
                </div>
              ) : null}
            </ArtTile>
            {collection && row.rarity_rank != null && (
              <Card padding="var(--space-7)">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={LABEL}>Rarity</span>
                  <RarityBadge rank={row.rarity_rank} total={row.rarity_total ?? undefined} />
                </div>
              </Card>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-7)" }}>
            <div>
              {collection && (
                <Link href={`/collections/${row.collection_id}`} style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>
                  {collection.name}
                </Link>
              )}
              <h1 style={{ font: "var(--type-h1)", letterSpacing: "var(--tracking-heading)", color: "var(--text-primary)", margin: "4px 0 0" }}>
                {row.name}
              </h1>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", marginTop: "var(--space-6)" }}>
                <span style={{ fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>Owner</span>
                {owner?.username ? (
                  <Link href={`/u/${owner.username}`} style={{ textDecoration: "none" }}>
                    <AddressChip address={owner.wallet_address ?? "unknown"} ens={owner.username} style={{ cursor: "pointer" }} />
                  </Link>
                ) : (
                  <AddressChip address={owner?.wallet_address ?? "unknown"} />
                )}
              </div>
            </div>

            <Card padding="var(--space-8)">
              {priceSol ? (
                <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-7)" }}>
                  <PriceDisplay label="Listed for" amount={priceSol} size="lg" />
                  {activeListing?.expires_at ? (
                    <Badge tone="live" dot style={{ marginBottom: 4 }}>
                      Ends in <Countdown target={activeListing.expires_at} now={now} style={{ marginLeft: 4 }} />
                    </Badge>
                  ) : null}
                </div>
              ) : (
                <span style={LABEL}>Not for sale</span>
              )}
              {buyerTotalSol ? (
                <div style={{ marginTop: "var(--space-4)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  + {FEE_LABEL} fee
                  {chargedRoyaltyBps > 0
                    ? ` + ${(chargedRoyaltyBps / 100).toFixed(1)}% royalty`
                    : viewerIsCreator
                      ? " · no royalty on your own collection"
                      : ""}{" "}
                  · you pay {buyerTotalSol} SOL
                </div>
              ) : null}
              {(topBidSol || lastSaleSol) && (
                <div style={{ display: "flex", gap: "var(--space-9)", marginTop: "var(--space-7)", paddingTop: "var(--space-6)", borderTop: "1px solid var(--border-subtle)" }}>
                  <div>
                    <div style={LABEL}>Top bid</div>
                    <div className="sol-num" style={{ fontSize: "var(--text-md)", color: "var(--text-primary)", marginTop: 2 }}>{topBidSol ? `${topBidSol} SOL` : "—"}</div>
                  </div>
                  <div>
                    <div style={LABEL}>Last sale</div>
                    <div className="sol-num" style={{ fontSize: "var(--text-md)", color: "var(--text-primary)", marginTop: 2 }}>{lastSaleSol ? `${lastSaleSol} SOL` : "—"}</div>
                  </div>
                </div>
              )}
              <div style={{ marginTop: "var(--space-7)" }}>
                {isOwner ? (
                  <OwnedNftControls
                    nft={{
                      id: row.id,
                      name: row.name,
                      imageUrl: row.image_url,
                      assetAddress: row.asset_address,
                      collectionId: row.collection_id,
                      collectionAddress: collection?.collection_address ?? null,
                      listing: activeListing
                        ? { id: activeListing.id, priceLamports: String(activeListing.price_lamports) }
                        : null,
                    }}
                    userId={user!.id}
                    floorSol={collectionFloorSol}
                    topBidSol={topBidSol ?? null}
                    royaltyBps={royaltyBps}
                  />
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "var(--space-5)" }}>
                    {activeListing ? (
                      <BuyButton
                        listingId={activeListing.id}
                        sellerId={String(activeListing.seller_id)}
                        priceSol={priceSol!}
                        viewerId={user?.id ?? null}
                        itemName={row.name}
                        collectionName={collection?.name}
                        royaltyBps={chargedRoyaltyBps}
                        solUsd={solUsd}
                      />
                    ) : (
                      <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>Not listed.</p>
                    )}
                    <BidButton
                      nftId={row.id}
                      itemName={row.name}
                      collectionName={collection?.name}
                      viewerId={user?.id ?? null}
                      isOwner={isOwner}
                      floorSol={priceSol ?? undefined}
                      topBidSol={topBidSol}
                    />
                  </div>
                )}
              </div>
            </Card>

            {row.description && (
              <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: 0, textWrap: "pretty" }}>{row.description}</p>
            )}
          </div>
        </div>

        <div style={{ marginTop: "var(--space-11)" }}>
          <TabPanels
            tabs={[
              { value: "traits", label: "Traits" },
              { value: "offers", label: "Offers" },
              { value: "activity", label: "Activity" },
              { value: "details", label: "Details" },
            ]}
            counts={{ traits: traits.length, offers: offers.length, activity: feed.length }}
            panels={{
              traits:
                traits.length > 0 ? (
                  <div className="sol-cards" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "var(--space-5)" }}>
                    {traits.map((t) => (
                      <div key={t.trait} style={{ background: "var(--surface-card)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)", padding: "var(--space-6)" }}>
                        <div style={{ font: "var(--type-label)", fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", color: "var(--text-tertiary)" }}>{t.trait}</div>
                        <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", marginTop: 3 }}>{t.value}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>No traits recorded for this item.</p>
                ),
              offers:
                offers.length > 0 ? (
                  <Card padding={0}>
                    <OffersList offers={offers} viewerId={user?.id ?? null} isOwner={isOwner} listPriceSol={priceSol} nftId={row.id} />
                  </Card>
                ) : (
                  <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>No active offers.</p>
                ),
              activity: (
                <div className="sol-cols-1-sm" style={{ display: "grid", gridTemplateColumns: showHistory ? "1fr 1.4fr" : "1fr", gap: "var(--space-6)", alignItems: "start" }}>
                  {showHistory && (
                    <Card padding="var(--space-7)">
                      <FloorChartCard data={priceSeries} height={160} />
                    </Card>
                  )}
                  {feed.length > 0 ? (
                    <Card padding={0}>
                      {feed.map((f, i) => (
                        <ActivityRow key={f.id} {...f} style={i === feed.length - 1 ? { borderBottom: "none" } : undefined} />
                      ))}
                    </Card>
                  ) : (
                    <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>No activity yet.</p>
                  )}
                </div>
              ),
              details: (
                <div className="sol-cols-1-sm" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)", alignItems: "start" }}>
                  <Card padding="var(--space-7)">
                    {details.map(([k, v], i) => (
                      <div
                        key={k}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "var(--space-6)",
                          padding: "var(--space-4) 0",
                          borderBottom: i === details.length - 1 ? "none" : "1px solid var(--border-subtle)",
                        }}
                      >
                        <span style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>{k}</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-primary)", textAlign: "right" }}>{v}</span>
                      </div>
                    ))}
                  </Card>
                  <Card padding="var(--space-7)">
                    <div style={{ ...LABEL, marginBottom: "var(--space-6)" }}>Order book</div>
                    <DepthChart bids={depth.bids} asks={depth.asks} height={132} />
                  </Card>
                </div>
              ),
            }}
          />
        </div>
    </main>
  );
}

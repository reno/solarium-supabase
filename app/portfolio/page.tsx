import Link from "next/link";
import { redirect } from "next/navigation";

import { FloorChartCard } from "@/components/charts/floor-chart-card";
import { ActivityRow, Card } from "@/components/design";
import { OffersList } from "@/components/offers/offers-list";
import { PortfolioHoldings, type Holding } from "@/components/portfolio/portfolio-holdings";
import { PortfolioOffers, type PortfolioOffer } from "@/components/portfolio/portfolio-offers";
import { TabPanels } from "@/components/tab-panels";
import { toFeedItem, type RawActivity } from "@/lib/activities/feed";
import { mapCollectionOffers, mapOffers, type OfferEntry, type RawCollectionOffer, type RawOffer } from "@/lib/offers/map";
import { getSolUsd } from "@/lib/price/sol";
import { lamportsToSol } from "@/lib/solana/lamports";
import { createClient } from "@/lib/supabase/server";

const LABEL: React.CSSProperties = {
  font: "var(--type-label)",
  fontSize: "var(--text-2xs)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-label)",
  color: "var(--text-tertiary)",
};

type HoldingCollection = { name: string | null; collection_address: string | null; royalty_bps: number | null };
type NftHolding = {
  id: string;
  name: string;
  image_url: string;
  asset_address: string;
  collection_id: string | null;
  collections: HoldingCollection | HoldingCollection[] | null;
  listings: { id: string; price_lamports: string | number; status: string }[] | null;
};

function untilLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  if (ms < 3_600_000) return `in ${Math.ceil(ms / 60_000)}m`;
  if (ms < 86_400_000) return `in ${Math.floor(ms / 3_600_000)}h`;
  return `in ${Math.floor(ms / 86_400_000)}d`;
}

export default async function PortfolioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const [holdingsRes, offersRes, activityRes] = await Promise.all([
    supabase
      .from("nfts")
      .select("id, name, image_url, asset_address, collection_id, collections(name, collection_address, royalty_bps), listings(id, price_lamports, status)")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("offers")
      .select("id, price_lamports, expires_at, nft:nfts(name)")
      .eq("bidder_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    supabase
      .from("activities")
      .select("id, type, lamports, created_at, nft:nfts(name, image_url, collection:collections(reveal_at)), actor:profiles!activities_actor_id_fkey(username, wallet_address), counterparty:profiles!activities_counterparty_id_fkey(username, wallet_address)")
      .or(`actor_id.eq.${user.id},counterparty_id.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const rows = (holdingsRes.data ?? []) as NftHolding[];
  const heldIds = rows.map((r) => r.id);
  const heldCollectionIds = [...new Set(rows.map((r) => r.collection_id).filter(Boolean))] as string[];

  const [saleHistRes, floorRes, inboundItemRes, inboundCollectionRes] = await Promise.all([
    heldIds.length
      ? supabase.from("activities").select("nft_id, actor_id, counterparty_id, lamports, created_at").in("nft_id", heldIds).eq("type", "sale").order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    heldCollectionIds.length
      ? supabase.from("nfts").select("collection_id, listings(price_lamports, status)").in("collection_id", heldCollectionIds)
      : Promise.resolve({ data: [] }),
    heldIds.length
      ? supabase
          .from("offers")
          .select("id, nft_id, bidder_id, price_lamports, expires_at, status, accepted_tx, nft:nfts(name, owner_id, listings(status)), bidder:profiles!offers_bidder_id_fkey(username, wallet_address)")
          .in("nft_id", heldIds)
          .in("status", ["active", "accepted"])
          .order("price_lamports", { ascending: false })
      : Promise.resolve({ data: [] }),
    heldCollectionIds.length
      ? supabase
          .from("offers")
          .select("id, collection_id, bidder_id, price_lamports, quantity, expires_at, status, bidder:profiles!offers_bidder_id_fkey(username, wallet_address)")
          .in("collection_id", heldCollectionIds)
          .eq("status", "active")
          .neq("bidder_id", user.id)
          .order("price_lamports", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const floorByCollection = new Map<string, number>();
  for (const n of (floorRes.data ?? []) as { collection_id: string | null; listings: { price_lamports: string | number; status: string }[] | null }[]) {
    if (!n.collection_id) continue;
    const active = (n.listings ?? []).find((l) => l.status === "active");
    if (!active) continue;
    const sol = Number(lamportsToSol(BigInt(String(active.price_lamports))));
    const cur = floorByCollection.get(n.collection_id);
    if (cur == null || sol < cur) floorByCollection.set(n.collection_id, sol);
  }

  const saleHist = (saleHistRes.data ?? []) as { nft_id: string; actor_id: string | null; counterparty_id: string | null; lamports: string | number | null }[];
  const lastSaleByNft = new Map<string, number>();
  const myCostByNft = new Map<string, number>();
  for (const a of saleHist) {
    const sol = Number(a.lamports ?? 0) / 1e9;
    lastSaleByNft.set(a.nft_id, sol);
    if (a.actor_id === user.id) myCostByNft.set(a.nft_id, sol);
  }

  const holdingValue = (r: NftHolding): number => {
    const active = (r.listings ?? []).find((l) => l.status === "active");
    if (active) return Number(lamportsToSol(BigInt(String(active.price_lamports))));
    if (lastSaleByNft.has(r.id)) return lastSaleByNft.get(r.id)!;
    if (r.collection_id && floorByCollection.has(r.collection_id)) return floorByCollection.get(r.collection_id)!;
    return 0;
  };

  const holdings: Holding[] = rows.map((r) => {
    const active = (r.listings ?? []).find((l) => l.status === "active");
    const collection = Array.isArray(r.collections) ? r.collections[0] : r.collections;
    const floor = r.collection_id ? floorByCollection.get(r.collection_id) : undefined;
    return {
      id: r.id,
      name: r.name,
      imageUrl: r.image_url,
      assetAddress: r.asset_address,
      collectionId: r.collection_id,
      collectionAddress: collection?.collection_address ?? null,
      listing: active ? { id: String(active.id), priceLamports: String(active.price_lamports) } : null,
      floorSol: floor != null ? String(floor) : null,
      royaltyBps: collection?.royalty_bps ?? 0,
    };
  });

  const totalValue = rows.reduce((sum, r) => sum + holdingValue(r), 0);
  const costBasis = rows.reduce((sum, r) => sum + (myCostByNft.get(r.id) ?? 0), 0);
  const collectionsHeld = heldCollectionIds.length;

  const offers: PortfolioOffer[] = (offersRes.data ?? []).map((o) => {
    const nft = Array.isArray(o.nft) ? o.nft[0] : o.nft;
    return { id: o.id, item: nft?.name ?? "—", offerSol: lamportsToSol(BigInt(String(o.price_lamports))), expiresLabel: untilLabel(o.expires_at) };
  });
  const offersLocked = offers.reduce((s, o) => s + parseFloat(o.offerSol), 0);

  const listedHeldByCollection = new Map<string, string>();
  for (const r of rows) {
    if (!r.collection_id || listedHeldByCollection.has(r.collection_id)) continue;
    if ((r.listings ?? []).some((l) => l.status === "active")) listedHeldByCollection.set(r.collection_id, r.id);
  }
  const collectionOfCollectionOffer = new Map(
    ((inboundCollectionRes.data ?? []) as { id: string; collection_id: string }[]).map((o) => [o.id, o.collection_id])
  );
  const receivedOffers: OfferEntry[] = [
    ...mapCollectionOffers((inboundCollectionRes.data ?? []) as unknown as RawCollectionOffer[]).map((o) => {
      const collectionId = collectionOfCollectionOffer.get(o.id);
      const bindNftId = collectionId ? listedHeldByCollection.get(collectionId) ?? null : null;
      return { ...o, bindNftId, acceptable: bindNftId !== null };
    }),
    ...mapOffers((inboundItemRes.data ?? []) as unknown as RawOffer[]).map((o) => ({ ...o, acceptable: true })),
  ];

  const feed = ((activityRes.data ?? []) as unknown as RawActivity[]).map((a) => toFeedItem(a));

  const solUsd = await getSolUsd();

  const signed = saleHist
    .filter((a) => a.actor_id === user.id || a.counterparty_id === user.id)
    .map((a) => (a.actor_id === user.id ? 1 : -1) * (Number(a.lamports ?? 0) / 1e9));
  const cumSeries = signed.map((_, i) => Math.round(signed.slice(0, i + 1).reduce((t, v) => t + v, 0) * 100) / 100);
  const series = cumSeries.length < 2 ? [0, ...cumSeries] : cumSeries;

  const plBps = costBasis > 0 ? Math.round(((totalValue - costBasis) / costBasis) * 10000) : 0;
  const plStr = `${plBps < 0 ? "−" : "+"}${Math.abs(plBps / 100).toFixed(1)}%`;

  const kpis: Array<{ l: string; v: string; s: string; tone?: "up" | "down" }> = [
    { l: "Portfolio value", v: `${totalValue.toFixed(2)} SOL`, s: `≈ $${Math.round(totalValue * solUsd).toLocaleString("en-US")}` },
    { l: "Unrealized P/L", v: plStr, s: "vs. cost basis", tone: plBps < 0 ? "down" : "up" },
    { l: "Items held", v: `${rows.length}`, s: `${collectionsHeld} collection${collectionsHeld === 1 ? "" : "s"}` },
    { l: "Open offers", v: `${offers.length}`, s: `${offersLocked.toFixed(2)} SOL bid` },
  ];

  return (
    <main style={{ maxWidth: "var(--page-max)", margin: "0 auto", width: "100%", flex: 1, padding: "var(--space-11) var(--page-gutter) var(--space-13)" }}>
      <h1 style={{ font: "var(--type-h1)", letterSpacing: "var(--tracking-heading)", color: "var(--text-primary)", margin: "0 0 var(--space-9)" }}>Portfolio</h1>

      <div className="sol-cols-5" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr) 1.4fr", gap: "var(--space-6)", marginBottom: "var(--space-10)" }}>
        {kpis.map((k) => (
          <Card key={k.l} padding="var(--space-7)">
            <div style={LABEL}>{k.l}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xl)", fontWeight: "var(--weight-semibold)", marginTop: 4, color: k.tone === "up" ? "var(--price-up)" : k.tone === "down" ? "var(--price-down)" : "var(--text-primary)" }}>{k.v}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 2 }}>{k.s}</div>
          </Card>
        ))}
        <Card padding="var(--space-7)">
          <FloorChartCard data={series} height={92} />
        </Card>
      </div>

      <h2 className="sol-label" style={{ margin: "0 0 var(--space-7)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>Portfolio</h2>
      <TabPanels
        tabs={[
          { value: "items", label: "Items" },
          { value: "offers", label: "Offers" },
          { value: "activity", label: "Activity" },
        ]}
        counts={{
          items: rows.length,
          offers: offers.length + receivedOffers.length,
          activity: feed.length,
        }}
        panels={{
          items:
            rows.length === 0 ? (
              <p style={{ margin: 0, padding: "var(--space-8)", borderRadius: "var(--radius-card)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
                Nothing here yet — mint a drop on the Launchpad.
              </p>
            ) : (
              <PortfolioHoldings holdings={holdings} userId={user.id} />
            ),
          offers: (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-9)" }}>
              <div>
                <div className="sol-label" style={{ marginBottom: "var(--space-6)" }}>Received · bids on your items</div>
                {receivedOffers.length === 0 ? (
                  <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>No bids on your items yet.</p>
                ) : (
                  <Card padding={0}>
                    <OffersList offers={receivedOffers} viewerId={user.id} isOwner={false} nftId={null} />
                  </Card>
                )}
              </div>
              <div>
                <div className="sol-label" style={{ marginBottom: "var(--space-6)" }}>Your bids</div>
                {offers.length === 0 ? (
                  <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
                    No open offers. <Link href="/" style={{ color: "var(--text-link)" }}>Browse collections</Link> to place one.
                  </p>
                ) : (
                  <PortfolioOffers offers={offers} bidderId={user.id} />
                )}
              </div>
            </div>
          ),
          activity:
            feed.length === 0 ? (
              <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>No activity yet.</p>
            ) : (
              <Card padding={0}>
                {feed.map((a, i) => <ActivityRow key={a.id} {...a} style={i === feed.length - 1 ? { borderBottom: "none" } : undefined} />)}
              </Card>
            ),
        }}
      />
    </main>
  );
}

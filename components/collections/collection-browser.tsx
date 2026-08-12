"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  ActivityRow,
  ArtTile,
  Button,
  Card,
  FilterRail,
  IconButton,
  NftCard,
  RarityBadge,
  Select,
  Tabs,
  Tag,
  type TraitGroup,
} from "@/components/design";
import { SweepBuyButton } from "@/components/listings/sweep-buy-button";
import type { FeedItem } from "@/lib/activities/feed";

export type BrowserItem = {
  id: string;
  name: string;
  imageUrl: string;
  priceSol: string | null;
  listingId: string | null;
  rank: number | null;
  rarityTotal: number | null;
  traits: { trait: string; value: string }[];
  listed: boolean;
  ownedByViewer?: boolean;
};

export type CollectionOffer = {
  id: string;
  nftId: string | null;
  nftName: string;
  priceSol: string;
  bidderName: string;
  bidderUsername: string | null;
  expiresAt: string;
  createdAt: string;
  isCollection?: boolean;
};

const SOL_PER_USD = 148.62;
const SORTS = ["Price low → high", "Price high → low", "Recently listed", "Rarity"];

function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  if (ms < 3_600_000) return `${Math.ceil(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

export function CollectionBrowser({
  items,
  traitGroups,
  activity,
  offersCount,
  collectionOffers,
  collectionName,
  royaltyBps = 0,
  solUsd,
}: {
  items: BrowserItem[];
  traitGroups: TraitGroup[];
  activity: FeedItem[];
  offersCount: number;
  collectionOffers?: CollectionOffer[];
  collectionName: string;
  royaltyBps?: number;
  solUsd?: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState("Items");
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [buyNow, setBuyNow] = useState(false);
  const [priceRange, setPriceRange] = useState<{ min?: string; max?: string }>({});
  const [sweep, setSweep] = useState<string[]>([]);
  const [sort, setSort] = useState(SORTS[0]);
  const [view, setView] = useState<"grid" | "list">("grid");

  const toggle = (t: string, v: string) =>
    setSelected((s) => {
      const cur = s[t] || [];
      return { ...s, [t]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
    });

  const chips = Object.entries(selected).flatMap(([t, vs]) => vs.map((v) => ({ t, v })));

  const shown = useMemo(() => {
    const min = priceRange.min ? parseFloat(priceRange.min) : null;
    const max = priceRange.max ? parseFloat(priceRange.max) : null;
    const filtered = items.filter((e) => {
      if (buyNow && !e.listed) return false;
      const price = e.priceSol ? parseFloat(e.priceSol) : null;
      if (min != null && (price == null || price < min)) return false;
      if (max != null && (price == null || price > max)) return false;
      for (const [t, vs] of Object.entries(selected)) {
        if (vs.length === 0) continue;
        if (!e.traits.some((tr) => tr.trait === t && vs.includes(tr.value))) return false;
      }
      return true;
    });
    const pAsc = (e: BrowserItem) => (e.priceSol != null ? parseFloat(e.priceSol) : Infinity);
    const pDesc = (e: BrowserItem) => (e.priceSol != null ? parseFloat(e.priceSol) : -Infinity);
    const arr = [...filtered];
    if (sort === "Price low → high") arr.sort((a, b) => pAsc(a) - pAsc(b));
    else if (sort === "Price high → low") arr.sort((a, b) => pDesc(b) - pDesc(a));
    else if (sort === "Rarity") arr.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
    else if (sort === "Recently listed") arr.sort((a, b) => Number(b.listed) - Number(a.listed));
    return arr;
  }, [items, selected, buyNow, priceRange, sort]);

  const buyable = (e: BrowserItem) => !!e.priceSol && !e.ownedByViewer;
  const sweepItems = shown.filter((e) => sweep.includes(e.id) && buyable(e));
  const sweepTotal = sweepItems.reduce((a, e) => a + parseFloat(e.priceSol!), 0);
  const toggleSweep = (idv: string) => setSweep((s) => (s.includes(idv) ? s.filter((x) => x !== idv) : [...s, idv]));

  return (
    <div style={{ display: "flex", gap: "var(--space-9)", paddingTop: "var(--space-7)" }}>
      <FilterRail
        traits={traitGroups}
        selected={selected}
        onToggle={toggle}
        buyNow={buyNow}
        onBuyNow={() => setBuyNow((v) => !v)}
        priceRange={priceRange}
        onPriceRange={setPriceRange}
      />
      <div style={{ flex: 1, minWidth: 0, paddingBottom: "var(--space-13)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", marginBottom: "var(--space-7)" }}>
          <Tabs
            tabs={["Items", "Activity", "Offers"]}
            value={tab}
            onChange={setTab}
            size="sm"
            counts={{ Items: String(shown.length), Offers: String(offersCount) }}
            style={{ border: "none", flex: 1 }}
          />
          <Select size="sm" options={SORTS} value={sort} onChange={(e) => setSort(e.target.value)} />
          <IconButton icon="layout-grid" label="Grid" active={view === "grid"} onClick={() => setView("grid")} />
          <IconButton icon="list" label="List" active={view === "list"} onClick={() => setView("list")} />
        </div>

        {tab === "Items" ? (
          <>
            {chips.length > 0 && (
              <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", marginBottom: "var(--space-7)" }}>
                {chips.map((c) => (
                  <Tag key={c.t + c.v} onRemove={() => toggle(c.t, c.v)}>
                    {c.t} · {c.v}
                  </Tag>
                ))}
                <button onClick={() => setSelected({})} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-link)", fontSize: "var(--text-xs)" }}>
                  Clear all
                </button>
              </div>
            )}
            {view === "grid" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "var(--grid-gap)" }}>
                {shown.map((e) => (
                  <NftCard
                    key={e.id}
                    name={e.name}
                    collection={collectionName}
                    price={e.priceSol ?? "—"}
                    rank={e.rank ?? undefined}
                    total={e.rarityTotal ?? undefined}
                    src={e.imageUrl}
                    selected={sweep.includes(e.id)}
                    onOpen={() => router.push(`/nft/${e.id}`)}
                    onToggleSelect={buyable(e) ? () => toggleSweep(e.id) : undefined}
                    onBuy={buyable(e) ? () => router.push(`/nft/${e.id}`) : undefined}
                  />
                ))}
              </div>
            ) : (
              <Card padding={0}>
                {shown.map((e, i) => (
                  <div
                    key={e.id}
                    onClick={() => router.push(`/nft/${e.id}`)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "40px 1fr 120px 110px",
                      alignItems: "center",
                      gap: "var(--space-6)",
                      height: 56,
                      padding: "0 var(--space-7)",
                      borderBottom: i === shown.length - 1 ? "none" : "1px solid var(--border-subtle)",
                      cursor: "pointer",
                    }}
                  >
                    <ArtTile src={e.imageUrl} label="" style={{ width: 40, height: 40 }} />
                    <span style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.name}</span>
                    {e.rank != null ? <RarityBadge rank={e.rank} total={e.rarityTotal ?? undefined} /> : <span />}
                    <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "var(--text-md)", color: "var(--text-primary)", textAlign: "right" }}>
                      {e.priceSol ? `${e.priceSol} SOL` : "—"}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </>
        ) : tab === "Activity" ? (
          <Card padding={0}>
            {activity.length === 0 ? (
              <p style={{ margin: 0, padding: "var(--space-8)", fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>No activity yet.</p>
            ) : (
              activity.map((a, i) => <ActivityRow key={a.id} {...a} collection={collectionName} style={i === activity.length - 1 ? { borderBottom: "none" } : undefined} />)
            )}
          </Card>
        ) : (
          collectionOffers && collectionOffers.length > 0 ? (
            <Card padding={0}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 140px 100px", gap: "var(--space-6)", padding: "var(--space-6) var(--space-7)", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ font: "var(--type-label)", fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", color: "var(--text-tertiary)" }}>Item</span>
                <span style={{ font: "var(--type-label)", fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", color: "var(--text-tertiary)" }}>Offer</span>
                <span style={{ font: "var(--type-label)", fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", color: "var(--text-tertiary)" }}>From</span>
                <span style={{ font: "var(--type-label)", fontSize: "var(--text-2xs)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", color: "var(--text-tertiary)" }}>Expires</span>
              </div>
              {collectionOffers.map((o, i) => (
                <div
                  key={o.id}
                  onClick={o.nftId ? () => router.push(`/nft/${o.nftId}`) : undefined}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 160px 140px 100px",
                    gap: "var(--space-6)",
                    alignItems: "center",
                    height: 56,
                    padding: "0 var(--space-7)",
                    borderBottom: i === collectionOffers.length - 1 ? "none" : "1px solid var(--border-subtle)",
                    cursor: o.nftId ? "pointer" : "default",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-4)", fontSize: "var(--text-md)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {o.isCollection ? <Tag>collection</Tag> : null}
                    {o.nftName}
                  </span>
                  <span className="sol-num" style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)", color: "var(--accent-2)" }}>{o.priceSol} SOL</span>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {o.bidderUsername ? `@${o.bidderUsername}` : o.bidderName}
                  </span>
                  <span className="sol-num" style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>{timeUntil(o.expiresAt)}</span>
                </div>
              ))}
            </Card>
          ) : (
            <Card padding="var(--space-9)" style={{ textAlign: "center", color: "var(--text-tertiary)", fontSize: "var(--text-md)" }}>
              {offersCount > 0 ? `${offersCount} open offer${offersCount === 1 ? "" : "s"} on this collection.` : "No offers yet."}
            </Card>
          )
        )}
      </div>

      {sweepItems.length > 0 && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 40,
            borderTop: "1px solid var(--border-default)",
            background: "color-mix(in oklab, var(--surface-1) 92%, transparent)",
            backdropFilter: "blur(12px)",
            padding: "var(--space-6) var(--page-gutter)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-8)",
          }}
        >
          <span className="sol-label">Sweep</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
            {sweepItems.length} item{sweepItems.length > 1 ? "s" : ""} · {sweepTotal.toFixed(2)} SOL
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>≈ ${Math.round(sweepTotal * SOL_PER_USD).toLocaleString("en-US")}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-5)" }}>
            <Button variant="ghost" onClick={() => setSweep([])}>Clear</Button>
            <SweepBuyButton
              items={sweepItems
                .filter((e) => e.listingId && e.priceSol)
                .map((e) => ({ id: e.id, name: e.name, priceSol: e.priceSol!, listingId: e.listingId! }))}
              royaltyBps={royaltyBps}
              solUsd={solUsd}
              onDone={() => setSweep([])}
            />
          </div>
        </div>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FloorChartCard } from "@/components/charts/floor-chart-card";
import { Badge, Button, Card, Sparkline } from "@/components/design";
import { CreatorSettings } from "@/components/creator/creator-settings";
import { LaunchpadSetup, type SetupCollection } from "@/components/launchpad/launchpad-setup";
import { lamportsToSol } from "@/lib/solana/lamports";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Creator studio",
  robots: { index: false, follow: false },
};

const LABEL: React.CSSProperties = {
  font: "var(--type-label)",
  fontSize: "var(--text-2xs)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-label)",
  color: "var(--text-tertiary)",
};

const COLLECTION_COLUMNS: Array<[string, boolean]> = [
  ["Collection", false],
  ["Items", true],
  ["Floor", false],
  ["Volume", true],
  ["Royalties", false],
  ["Rate", true],
];

type ListingLite = { price_lamports: string | number; status: string };
type NftLite = { id: string; collection_id: string; owner_id: string | null; listings: ListingLite[] | null };

export default async function CreatorDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: collectionsData } = await supabase
    .from("collections")
    .select("id, name, cover_url, royalty_bps")
    .eq("creator_id", user.id)
    .order("created_at", { ascending: true });
  const collections = collectionsData ?? [];
  const collIds = collections.map((c) => c.id);

  const bps = new Map<string, number>();
  for (const c of collections) bps.set(c.id, c.royalty_bps ?? 0);

  const nfts: NftLite[] = collIds.length
    ? (
        (
          await supabase
            .from("nfts")
            .select("id, collection_id, owner_id, listings(price_lamports, status)")
            .in("collection_id", collIds)
        ).data ?? []
      ).map((n) => n as NftLite)
    : [];
  const nftIds = nfts.map((n) => n.id);

  const sales = nftIds.length
    ? (
        await supabase
          .from("activities")
          .select("nft_id, lamports, created_at")
          .eq("type", "sale")
          .in("nft_id", nftIds)
          .order("created_at", { ascending: true })
      ).data ?? []
    : [];

  const nftColl = new Map<string, string>();
  for (const n of nfts) nftColl.set(n.id, n.collection_id);

  const agg = new Map<string, { items: number; floor: bigint | null; volume: bigint; royalty: bigint }>();
  for (const c of collections) agg.set(c.id, { items: 0, floor: null, volume: 0n, royalty: 0n });
  const holders = new Set<string>();
  for (const n of nfts) {
    const a = agg.get(n.collection_id)!;
    a.items += 1;
    if (n.owner_id) holders.add(n.owner_id);
    const active = (n.listings ?? []).find((l) => l.status === "active");
    if (active) {
      const p = BigInt(String(active.price_lamports));
      if (a.floor === null || p < a.floor) a.floor = p;
    }
  }
  let revenueCum = 0n;
  let volumeCum = 0n;
  const revenueSeries: number[] = [];
  const volumeSeries: number[] = [];
  for (const s of sales) {
    const cid = nftColl.get(s.nft_id);
    if (!cid) continue;
    const lam = BigInt(String(s.lamports ?? 0));
    const roy = (lam * BigInt(bps.get(cid) ?? 0)) / 10000n;
    const a = agg.get(cid)!;
    a.volume += lam;
    a.royalty += roy;
    revenueCum += roy;
    volumeCum += lam;
    revenueSeries.push(Number(revenueCum) / 1e9);
    volumeSeries.push(Number(volumeCum) / 1e9);
  }

  const totalRoyalty = collections.reduce((s, c) => s + agg.get(c.id)!.royalty, 0n);
  const totalVolume = collections.reduce((s, c) => s + agg.get(c.id)!.volume, 0n);

  const kpis: Array<{ l: string; v: string; spark?: number[] }> = [
    { l: "Royalties earned", v: `${lamportsToSol(totalRoyalty)} SOL`, spark: revenueSeries.length >= 2 ? revenueSeries : undefined },
    { l: "Secondary volume", v: `${lamportsToSol(totalVolume)} SOL`, spark: volumeSeries.length >= 2 ? volumeSeries : undefined },
    { l: "Unique holders", v: `${holders.size}` },
    { l: "Collections", v: `${collections.length}` },
  ];

  const royaltiesEarnedSol = lamportsToSol(totalRoyalty);

  const setupCollections: SetupCollection[] = collections.map((c) => ({ id: c.id, name: c.name }));

  return (
    <main style={{ maxWidth: "var(--page-max)", margin: "0 auto", width: "100%", flex: 1, padding: "var(--space-11) var(--page-gutter) var(--space-13)" }}>
      <div className="sol-wrap" style={{ display: "flex", alignItems: "center", gap: "var(--space-7)", marginBottom: "var(--space-9)" }}>
        <h1 style={{ font: "var(--type-h1)", letterSpacing: "var(--tracking-heading)", color: "var(--text-primary)", margin: 0 }}>Creator</h1>
        <Badge tone="accent">{collections.length} collection{collections.length === 1 ? "" : "s"}</Badge>
        <Link href="/launchpad/apply" style={{ marginLeft: "auto", textDecoration: "none" }}>
          <Button variant="secondary" icon="rocket">Apply to launch</Button>
        </Link>
      </div>

      {collections.length === 0 ? (
        <p style={{ margin: 0, padding: "var(--space-8)", borderRadius: "var(--radius-card)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
          You haven&apos;t created any collections yet. Launch a drop from the Launchpad to start earning royalties.
        </p>
      ) : (
        <>
          <div className="sol-cols-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-6)", marginBottom: "var(--space-6)" }}>
            {kpis.map((k) => (
              <Card key={k.l} padding="var(--space-7)">
                <div style={LABEL}>{k.l}</div>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "var(--space-5)", marginTop: 4 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xl)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>{k.v}</span>
                  {k.spark ? <Sparkline data={k.spark} tone="up" width={72} height={22} /> : null}
                </div>
              </Card>
            ))}
          </div>

          {revenueSeries.length >= 2 && (
            <Card padding="var(--space-8)" style={{ marginBottom: "var(--space-9)" }}>
              <div style={{ ...LABEL, marginBottom: "var(--space-6)" }}>Cumulative royalties</div>
              <FloorChartCard data={revenueSeries} height={180} />
            </Card>
          )}

          <h2 className="sol-label" style={{ margin: "0 0 var(--space-6)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>Collections</h2>
          <Card padding={0} style={{ marginBottom: "var(--space-10)" }}>
            <div className="sol-row sol-row-collections" style={{ display: "grid", gridTemplateColumns: "1fr 80px 110px 120px 120px 70px", gap: "var(--space-6)", padding: "var(--space-6) var(--space-7)", borderBottom: "1px solid var(--border-subtle)" }}>
              {COLLECTION_COLUMNS.map(([h, hideSm]) => (
                <span key={h} className={hideSm ? "sol-hide-sm" : undefined} style={LABEL}>{h}</span>
              ))}
            </div>
            {collections.map((c, i) => {
              const a = agg.get(c.id)!;
              return (
                <div key={c.id} className="sol-row sol-row-collections" style={{ display: "grid", gridTemplateColumns: "1fr 80px 110px 120px 120px 70px", gap: "var(--space-6)", alignItems: "center", height: 52, padding: "0 var(--space-7)", borderBottom: i === collections.length - 1 ? "none" : "1px solid var(--border-subtle)" }}>
                  <span style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                  <span className="sol-hide-sm" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-body)" }}>{a.items}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-body)" }}>{a.floor !== null ? `${lamportsToSol(a.floor)} SOL` : "—"}</span>
                  <span className="sol-hide-sm" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-body)" }}>{lamportsToSol(a.volume)} SOL</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--price-up)" }}>{lamportsToSol(a.royalty)} SOL</span>
                  <span className="sol-hide-sm" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>{((c.royalty_bps ?? 0) / 100).toFixed(1)}%</span>
                </div>
              );
            })}
          </Card>

          <h2 className="sol-label" style={{ margin: "var(--space-10) 0 var(--space-6)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>Royalty &amp; payout</h2>
          <CreatorSettings collections={collections.map((c) => ({ id: c.id, name: c.name, royaltyBps: c.royalty_bps ?? 0 }))} royaltiesEarnedSol={royaltiesEarnedSol} />

          <h2 className="sol-label" style={{ margin: "var(--space-10) 0 var(--space-6)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>Launchpad setup</h2>
          <LaunchpadSetup collections={setupCollections} userId={user.id} />
        </>
      )}
    </main>
  );
}

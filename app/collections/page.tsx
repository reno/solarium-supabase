import type { Metadata } from "next";
import Link from "next/link";

import { ArtTile, Badge, Icon } from "@/components/design";
import { pageMetadata } from "@/lib/seo/metadata";
import { lamportsToSol } from "@/lib/solana/lamports";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 48;

const DESCRIPTION =
  "Every collection on Solarium — floor price, listings and volume across the whole Solana marketplace.";

type CollectionRow = {
  id: string;
  name: string;
  cover_url: string | null;
  verified: boolean;
  created_at: string;
};

type NftRow = {
  collection_id: string | null;
  owner_id: string | null;
  listings: { price_lamports: string | number; status: string }[] | null;
};

type MarketStatsRow = { collection_id: string; volume_all: string | number };

function pageNumber(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 1 ? n : 1;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const page = pageNumber((await searchParams).page);
  return pageMetadata({
    title: page > 1 ? `Collections — page ${page}` : "Collections",
    description: DESCRIPTION,
    path: page > 1 ? `/collections?page=${page}` : "/collections",
  });
}

export default async function CollectionsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = pageNumber((await searchParams).page);
  const from = (page - 1) * PAGE_SIZE;
  const supabase = await createClient();

  const { data: collectionRows, count } = await supabase
    .from("collections")
    .select("id, name, cover_url, verified, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const collections = (collectionRows ?? []) as CollectionRow[];
  const ids = collections.map((c) => c.id);

  const [nftsRes, statsRes] = await Promise.all([
    ids.length
      ? supabase.from("nfts").select("collection_id, owner_id, listings(price_lamports, status)").in("collection_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase.from("collection_market_stats").select("collection_id, volume_all").in("collection_id", ids)
      : Promise.resolve({ data: [] }),
  ]);

  const agg = new Map<string, { floor: bigint | null; listed: number; total: number; owners: Set<string> }>();
  for (const id of ids) agg.set(id, { floor: null, listed: 0, total: 0, owners: new Set() });
  for (const n of (nftsRes.data ?? []) as NftRow[]) {
    const a = n.collection_id ? agg.get(n.collection_id) : undefined;
    if (!a) continue;
    a.total += 1;
    if (n.owner_id) a.owners.add(n.owner_id);
    const active = (n.listings ?? []).find((l) => l.status === "active");
    if (active) {
      a.listed += 1;
      const price = BigInt(String(active.price_lamports));
      if (a.floor === null || price < a.floor) a.floor = price;
    }
  }

  const volumeById = new Map(
    ((statsRes.data ?? []) as MarketStatsRow[]).map((s) => [s.collection_id, BigInt(String(s.volume_all))])
  );

  const total = count ?? collections.length;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main style={{ maxWidth: "var(--page-max)", margin: "0 auto", width: "100%", flex: 1, padding: "var(--space-11) var(--page-gutter) var(--space-13)" }}>
      <h1 style={{ font: "var(--type-h1)", letterSpacing: "var(--tracking-heading)", color: "var(--text-primary)", margin: 0 }}>Collections</h1>
      <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: "var(--space-4) 0 var(--space-10)", maxWidth: 620, textWrap: "pretty" }}>
        {DESCRIPTION}
      </p>

      {collections.length === 0 ? (
        <p style={{ margin: 0, padding: "var(--space-8)", borderRadius: "var(--radius-card)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
          No collections yet. <Link href="/launchpad/apply" style={{ color: "var(--text-link)" }}>Launch the first one.</Link>
        </p>
      ) : (
        <div className="sol-cards" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "var(--grid-gap)" }}>
          {collections.map((c) => {
            const a = agg.get(c.id);
            const volume = volumeById.get(c.id) ?? 0n;
            return (
              <Link
                key={c.id}
                href={`/collections/${c.id}`}
                style={{
                  display: "block",
                  background: "var(--surface-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-card)",
                  overflow: "hidden",
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                <div style={{ padding: "var(--space-4)", paddingBottom: 0 }}>
                  <ArtTile src={c.cover_url ?? undefined} label={c.name} alt={`${c.name} cover art`} sizes="(max-width: 767px) 50vw, 240px" />
                </div>
                <div style={{ padding: "var(--space-5) var(--space-5) var(--space-6)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
                    <span style={{ fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.name}
                    </span>
                    {c.verified ? <Icon name="badge-check" size={14} color="var(--accent-2)" /> : null}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-5)", marginTop: "var(--space-5)" }}>
                    <div>
                      <div className="sol-label" style={{ fontSize: "var(--text-2xs)" }}>Floor</div>
                      <div className="sol-num" style={{ fontSize: "var(--text-md)", color: "var(--text-primary)", marginTop: 2 }}>
                        {a?.floor != null ? `${lamportsToSol(a.floor)} SOL` : "—"}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="sol-label" style={{ fontSize: "var(--text-2xs)" }}>Volume</div>
                      <div className="sol-num" style={{ fontSize: "var(--text-md)", color: "var(--text-primary)", marginTop: 2 }}>
                        {volume > 0n ? `${lamportsToSol(volume)} SOL` : "—"}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-5)", marginTop: "var(--space-5)", fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
                    <span>{a?.total ?? 0} items</span>
                    <span>{a?.listed ?? 0} listed</span>
                    <span>{a?.owners.size ?? 0} owners</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {lastPage > 1 ? (
        <nav aria-label="Collections pages" style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", marginTop: "var(--space-10)" }}>
          {page > 1 ? (
            <Link href={page === 2 ? "/collections" : `/collections?page=${page - 1}`} style={{ color: "var(--text-link)", fontSize: "var(--text-md)" }}>
              ← Previous
            </Link>
          ) : null}
          <Badge>
            Page {page} of {lastPage}
          </Badge>
          {page < lastPage ? (
            <Link href={`/collections?page=${page + 1}`} style={{ color: "var(--text-link)", fontSize: "var(--text-md)" }}>
              Next →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}

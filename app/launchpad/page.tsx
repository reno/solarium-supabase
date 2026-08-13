import Link from "next/link";

import { ArtTile, Badge, Button, Card } from "@/components/design";
import { TabPanels } from "@/components/tab-panels";
import { resolvePhases, type RawPhase } from "@/lib/launchpad/launchpad";
import { createClient } from "@/lib/supabase/server";

type PhaseRow = {
  collection_id: string;
  collection: { id: string; name: string; cover_url: string | null; reveal_at: string | null } | { id: string; name: string; cover_url: string | null; reveal_at: string | null }[] | null;
};

type LaunchpadCard = {
  id: string;
  name: string;
  coverUrl: string | null;
  status: "live" | "upcoming" | "ended";
  subtitle?: string;
  revealAt: string | null;
  mintedCount?: number;
  totalCount?: number;
  soldOutTime?: string;
};

export default async function LaunchpadIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: phaseRows } = await supabase
    .from("mint_phases")
    .select("*, collection:collections(id, name, cover_url, reveal_at)");

  const byId = new Map<string, LaunchpadCard>();
  for (const phaseRow of (phaseRows ?? []) as (RawPhase & PhaseRow)[]) {
    const c = Array.isArray(phaseRow.collection) ? phaseRow.collection[0] : phaseRow.collection;
    if (!c) continue;
    
    if (!byId.has(c.id)) {
      const [{ data: collectionPhases }, { data: nfts }, { data: machine }] = await Promise.all([
        supabase.from("mint_phases").select("*").eq("collection_id", c.id),
        supabase.from("nfts").select("id, owner_id, created_at, collections!inner(creator_id)").eq("collection_id", c.id),
        supabase.from("candy_machines").select("items_available, items_redeemed").eq("collection_id", c.id).maybeSingle(),
      ]);

      const { active } = resolvePhases((collectionPhases ?? []) as RawPhase[]);
      const status = active?.status ?? "ended";

      let mintedCount = 0;
      let totalCount = 0;
      if (machine) {
        totalCount = machine.items_available;
        mintedCount = machine.items_redeemed;
      } else if (nfts && nfts.length > 0) {
        const firstNft = nfts[0] as { owner_id: string | null; collections: { creator_id: string } | { creator_id: string }[] | null };
        const creatorId = Array.isArray(firstNft?.collections) 
          ? firstNft.collections[0]?.creator_id 
          : firstNft?.collections?.creator_id;
        totalCount = nfts.length;
        mintedCount = nfts.filter((n: { owner_id: string | null }) => n.owner_id && n.owner_id !== creatorId).length;
      }
      
      byId.set(c.id, {
        id: c.id,
        name: c.name,
        coverUrl: c.cover_url,
        status,
        revealAt: c.reveal_at,
        mintedCount,
        totalCount,
      });
    }
  }
  
  const allLaunches = Array.from(byId.values());
  const live = allLaunches.filter((l) => l.status === "live");
  const upcoming = allLaunches.filter((l) => l.status === "upcoming");
  const ended = allLaunches.filter((l) => l.status === "ended");

  const renderCard = (l: LaunchpadCard) => (
    <Link key={l.id} href={`/launchpad/${l.id}`} style={{ textDecoration: "none" }}>
      <Card padding={0} interactive>
        <div style={{ padding: "var(--space-4)", paddingBottom: 0 }}>
          <ArtTile src={l.coverUrl ?? undefined} label={l.name} ratio="16 / 9" />
        </div>
        <div style={{ padding: "var(--space-6)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
            <div style={{ fontSize: "var(--text-base)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", flex: 1 }}>{l.name}</div>
            {l.status === "live" && <Badge tone="live" dot>Live</Badge>}
            {l.status === "upcoming" && <Badge tone="neutral">Upcoming</Badge>}
            {l.status === "ended" && <Badge tone="neutral">Ended</Badge>}
          </div>
          {l.subtitle && (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-tertiary)", marginTop: 3 }}>{l.subtitle}</div>
          )}
          {l.status === "live" && l.totalCount ? (
            <div style={{ marginTop: "var(--space-5)" }}>
              <div style={{ height: 5, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${Math.round(((l.mintedCount ?? 0) / l.totalCount) * 100)}%`, height: "100%", background: "var(--accent)" }} />
              </div>
              <div style={{ marginTop: "var(--space-3)", fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)" }}>
                {l.mintedCount} / {l.totalCount} minted · {Math.round(((l.mintedCount ?? 0) / l.totalCount) * 100)}%
              </div>
            </div>
          ) : null}
          {l.status === "ended" && l.totalCount !== undefined && (
            <div style={{ marginTop: "var(--space-5)", paddingTop: "var(--space-5)", borderTop: "1px solid var(--border-subtle)" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                {l.mintedCount === l.totalCount 
                  ? "Sold out"
                  : `${Math.round((l.mintedCount! / l.totalCount) * 100)}% minted`}
                {" · "}
                {l.mintedCount} / {l.totalCount}
              </div>
            </div>
          )}
        </div>
      </Card>
    </Link>
  );

  return (
    <main style={{ maxWidth: "var(--page-max)", margin: "0 auto", width: "100%", flex: 1, padding: "var(--space-13) var(--page-gutter)" }}>
      <h1 style={{ font: "var(--type-h1)", letterSpacing: "var(--tracking-heading)", color: "var(--text-primary)", margin: 0 }}>Launchpad</h1>
      <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: "var(--space-4) 0 var(--space-10)" }}>
        Phased mints from Solarium creators. Buyers mint straight from a candy machine that enforces
        the price, window, per-wallet limit and allowlist on chain.
      </p>

      {allLaunches.length === 0 ? (
        <p style={{ margin: 0, padding: "var(--space-8)", borderRadius: "var(--radius-card)", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>
          No live launchpads yet.
        </p>
      ) : (
        <TabPanels
          tabs={[
            { value: "live", label: "Live" },
            { value: "upcoming", label: "Upcoming" },
            { value: "ended", label: "Ended" },
          ]}
          counts={{
            live: live.length,
            upcoming: upcoming.length,
            ended: ended.length,
          }}
          panels={{
            live:
              live.length === 0 ? (
                <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>No live mints.</p>
              ) : (
                <div className="sol-cards-wide" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--grid-gap)" }}>
                  {live.map(renderCard)}
                </div>
              ),
            upcoming:
              upcoming.length === 0 ? (
                <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>No upcoming mints.</p>
              ) : (
                <div className="sol-cards-wide" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--grid-gap)" }}>
                  {upcoming.map(renderCard)}
                </div>
              ),
            ended:
              ended.length === 0 ? (
                <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>No ended mints.</p>
              ) : (
                <div className="sol-cards-wide" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--grid-gap)" }}>
                  {ended.map(renderCard)}
                </div>
              ),
          }}
        />
      )}

      {user && (
        <div style={{ marginTop: "var(--space-13)", paddingTop: "var(--space-10)", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "flex-start" }}>
          <Link href="/launchpad/apply" style={{ textDecoration: "none" }}>
            <Button variant="primary" icon="rocket">Launch a collection</Button>
          </Link>
        </div>
      )}
    </main>
  );
}

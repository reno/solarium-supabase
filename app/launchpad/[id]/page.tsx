import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { ArtTile, Badge, Button, Card, Icon } from "@/components/design";
import { CandyMachinePanel, type SerializedPhase } from "@/components/launchpad/candy-machine-panel";
import { CandyMintButton } from "@/components/launchpad/candy-mint-button";
import { PendingMintNotice } from "@/components/launchpad/pending-mint-notice";
import { Countdown } from "@/components/launchpad/countdown";
import { BalanceEligibilityLine } from "@/components/launchpad/mint-eligibility";
import { RemindMe } from "@/components/launchpad/remind-me";
import { RevealPanel } from "@/components/launchpad/reveal-panel";
import { LaunchpadSetup } from "@/components/launchpad/launchpad-setup";
import { OffersList } from "@/components/offers/offers-list";
import { mapCollectionOffers, mapOffers, type OfferEntry, type RawCollectionOffer, type RawOffer } from "@/lib/offers/map";
import { serverNow } from "@/lib/format/relative-time";
import { shortWallet } from "@/lib/format/wallet";
import { countdownTarget, resolvePhases, type RawPhase } from "@/lib/launchpad/launchpad";
import { getSolUsd } from "@/lib/price/sol";
import { createClient } from "@/lib/supabase/server";

type RawCandyMachine = {
  id: string;
  candy_machine_address: string;
  candy_guard_address: string;
  items_available: number;
  items_loaded: number;
  items_redeemed: number;
  prefix_name: string;
  prefix_uri: string;
};

const DOT: Record<string, string> = {
  live: "var(--live)",
  ended: "var(--text-disabled)",
  upcoming: "var(--border-strong)",
};

export default async function LaunchpadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ supply?: string }>;
}) {
  const { id } = await params;
  const { supply: supplyParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: collection } = await supabase
    .from("collections")
    .select(
      "id, name, description, cover_url, collection_address, creator_id, royalty_bps, reveal_at, creator:profiles!collections_creator_id_fkey(username, wallet_address)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!collection) notFound();

  const [phasesResult, itemsResult, viewerProfileResult, machineResult, allowlistResult] = await Promise.all([
    supabase.from("mint_phases").select("*").eq("collection_id", id),
    supabase
      .from("nfts")
      .select("id, name, image_url, asset_address, item_number, owner_id, listings(id, price_lamports, status, seller_id, buyer_id)")
      .eq("collection_id", id)
      .order("item_number", { ascending: true }),
    user ? supabase.from("profiles").select("wallet_address").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("candy_machines").select("*").eq("collection_id", id).maybeSingle(),
    supabase.from("launchpad_allowlist").select("wallet_address").eq("collection_id", id),
  ]);

  const rawPhases = (phasesResult.data ?? []) as RawPhase[];
  const viewerId = user?.id ?? null;
  const isCreator = viewerId === collection.creator_id;
  const isDraft = rawPhases.length === 0;
  if (isDraft && !isCreator) notFound();
  const { phases, active } = resolvePhases(rawPhases);
  const creator = Array.isArray(collection.creator) ? collection.creator[0] : collection.creator;
  const serializedPhases: SerializedPhase[] = rawPhases.map((p) => ({
    id: p.id,
    name: p.name,
    priceLamports: String(p.price_lamports),
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    perWalletLimit: p.per_wallet_limit,
    allowlistOnly: p.allowlist_only,
    position: p.position,
    groupLabel: p.group_label ?? null,
  }));

  const machineRow = machineResult.data as RawCandyMachine | null;
  const machine = machineRow
    ? {
        id: machineRow.id,
        candyMachineAddress: machineRow.candy_machine_address,
        candyGuardAddress: machineRow.candy_guard_address,
        itemsAvailable: machineRow.items_available,
        itemsLoaded: machineRow.items_loaded,
        itemsRedeemed: machineRow.items_redeemed,
        prefixName: machineRow.prefix_name,
        prefixUri: machineRow.prefix_uri,
      }
    : null;
  const allowlist = (allowlistResult.data ?? []).map((a: { wallet_address: string }) => a.wallet_address);

  // Items only exist once buyers mint them out of the candy machine, so supply comes from the
  // machine's own counters. A collection without one has nothing to mint yet.
  const items = itemsResult.data ?? [];
  const total = machine?.itemsAvailable ?? 0;
  const minted = machine?.itemsRedeemed ?? 0;
  const pct = total ? Math.round((minted / total) * 100) : 0;

  let viewerMintCount = 0;
  if (viewerId && machine) {
    const { count } = await supabase
      .from("activities")
      .select("id, nft:nfts!inner(collection_id)", { count: "exact", head: true })
      .eq("type", "mint")
      .eq("actor_id", viewerId)
      .eq("nft.collection_id", id);
    viewerMintCount = count ?? 0;
  }

  const viewerWallet = viewerProfileResult.data?.wallet_address ?? null;
  let allowlisted = true;
  if (active?.allowlistOnly && viewerWallet) {
    const { count } = await supabase
      .from("launchpad_allowlist")
      .select("wallet_address", { count: "exact", head: true })
      .eq("collection_id", id)
      .eq("wallet_address", viewerWallet);
    allowlisted = (count ?? 0) > 0;
  } else if (active?.allowlistOnly) {
    allowlisted = false;
  }

  const candyAvailable = machine ? Math.max(0, Math.min(machine.itemsLoaded, machine.itemsAvailable) - machine.itemsRedeemed) : 0;
  // No machine deployed, or one whose config lines aren't fully loaded: there is nothing a
  // buyer could mint even while a phase window is open.
  const notOpenYet = machine ? candyAvailable === 0 && machine.itemsLoaded < machine.itemsAvailable : true;

  let disabledReason: string | null = null;
  if (!active || active.status !== "live") disabledReason = "Mint not live";
  else if (viewerId === collection.creator_id) disabledReason = "You're the creator";
  else if (active.allowlistOnly && !allowlisted) disabledReason = "Allowlist only";
  else if (active.perWalletLimit != null && viewerMintCount >= active.perWalletLimit) disabledReason = "Wallet limit reached";
  else if (notOpenYet) disabledReason = "Not loaded yet";
  else if (candyAvailable === 0) disabledReason = "Minted out";

  const target = countdownTarget(active);
  const now = serverNow();
  const headlinePrice = active?.priceSol ?? "—";
  const solUsd = await getSolUsd();

  type PanelState = "draft" | "live" | "upcoming" | "unlisted" | "soldout" | "ended";
  const hasSupplyToMint = candyAvailable > 0;
  const panelState: PanelState = isDraft
    ? "draft"
    : !active || active.status === "ended"
      ? "ended"
      : active.status === "upcoming"
        ? "upcoming"
        : hasSupplyToMint
          ? "live"
          : notOpenYet
            ? "unlisted"
            : "soldout";
  const stateBadge: Record<PanelState, { tone: "live" | "neutral" | "accent"; label: string }> = {
    draft: { tone: "neutral", label: "Draft" },
    live: { tone: "live", label: "Minting" },
    upcoming: { tone: "neutral", label: "Upcoming" },
    unlisted: { tone: "neutral", label: "Not open" },
    soldout: { tone: "accent", label: "Minted out" },
    ended: { tone: "neutral", label: "Ended" },
  };
  const openDate = active
    ? new Date(active.startsAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  const viewerOwnedIds = new Set(viewerId ? items.filter((e) => e.owner_id === viewerId).map((e) => e.id) : []);
  const bindableNftId =
    items.find((e) => viewerOwnedIds.has(e.id) && (e.listings ?? []).some((l: { status: string }) => l.status === "active"))?.id ?? null;

  const [itemOffersRes, collectionOffersRes] = viewerOwnedIds.size
    ? await Promise.all([
        supabase
          .from("offers")
          .select("id, nft_id, bidder_id, price_lamports, expires_at, status, accepted_tx, nft:nfts(name, owner_id, listings(status)), bidder:profiles!offers_bidder_id_fkey(username, wallet_address)")
          .in("nft_id", items.map((e) => e.id))
          .in("status", ["active", "accepted"])
          .order("price_lamports", { ascending: false }),
        supabase
          .from("offers")
          .select("id, bidder_id, price_lamports, quantity, expires_at, status, bidder:profiles!offers_bidder_id_fkey(username, wallet_address)")
          .eq("collection_id", id)
          .eq("status", "active")
          .order("price_lamports", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];

  const dropOffers: OfferEntry[] = [
    ...mapCollectionOffers((collectionOffersRes.data ?? []) as unknown as RawCollectionOffer[]).map((o) => ({
      ...o,
      acceptable: bindableNftId !== null,
    })),
    ...mapOffers((itemOffersRes.data ?? []) as unknown as RawOffer[]).map((o) => ({
      ...o,
      acceptable: !!o.nftId && viewerOwnedIds.has(o.nftId),
    })),
  ];

  return (
    <main style={{ width: "100%", flex: 1 }}>
      <div style={{ position: "relative" }}>
        <ArtTile src={collection.cover_url ?? undefined} label="launch banner · 6:1" ratio="6 / 1" radius="0" style={{ border: "none" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, var(--bg-page), transparent 65%)" }} />
      </div>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 var(--page-gutter) var(--space-13)" }}>
        <div style={{ marginTop: "var(--space-6)" }}>
          <BackLink />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: "var(--space-10)", marginTop: "var(--space-6)", alignItems: "start" }}>
          <div>
            <ArtTile src={collection.cover_url ?? undefined} label="mint preview · 1:1" radius="var(--radius-card)" style={{ maxWidth: 520 }} />
            <div style={{ marginTop: "var(--space-9)", maxWidth: 620 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
                <h1 style={{ font: "var(--type-h1)", letterSpacing: "var(--tracking-heading)", color: "var(--text-primary)", margin: 0 }}>{collection.name}</h1>
                <Badge tone={stateBadge[panelState].tone} dot={panelState === "live"}>{stateBadge[panelState].label}</Badge>
              </div>
              <p style={{ margin: "var(--space-4) 0 0", fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>
                by{" "}
                {creator?.username ? (
                  <Link href={`/u/${creator.username}`} style={{ color: "var(--text-link)" }}>@{creator.username}</Link>
                ) : (
                  shortWallet(creator?.wallet_address)
                )}
              </p>
              {collection.description && (
                <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", textWrap: "pretty", marginTop: "var(--space-6)" }}>{collection.description}</p>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", position: "sticky", top: "calc(var(--nav-h) + var(--space-7))" }}>
            <Card padding="var(--space-8)">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ font: "var(--type-label)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", color: "var(--text-tertiary)" }}>
                  {active ? active.name : "Mint"}
                </span>
                {target ? (
                  <span style={{ fontSize: "var(--text-md)", color: "var(--accent)" }}>
                    {target.label} <Countdown target={target.iso} now={now} />
                  </span>
                ) : null}
              </div>
              {panelState === "live" || panelState === "upcoming" ? (
                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-4)", marginTop: "var(--space-6)" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-3xl)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>{headlinePrice}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", color: "var(--text-secondary)" }}>SOL</span>
                </div>
              ) : panelState === "draft" ? (
                <div style={{ marginTop: "var(--space-6)", font: "var(--type-h2)", color: "var(--text-primary)" }}>
                  Not live yet
                </div>
              ) : (
                <div style={{ marginTop: "var(--space-6)", font: "var(--type-h2)", color: "var(--text-primary)" }}>
                  {panelState === "soldout" ? "Minted out" : panelState === "unlisted" ? "Not open yet" : "Mint ended"}
                </div>
              )}

              {(panelState === "draft" || panelState === "unlisted") && (
                <div style={{ marginTop: "var(--space-7)", paddingTop: "var(--space-6)", borderTop: "1px solid var(--border-subtle)", display: "flex", alignItems: "flex-start", gap: "var(--space-4)" }}>
                  <Icon name="info" size={14} color="var(--text-tertiary)" style={{ position: "relative", top: 2 }} />
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                    {panelState === "draft"
                      ? "Add a mint phase and open this drop below."
                      : machine
                        ? isCreator
                          ? `The phase is open, but only ${machine.itemsLoaded} of ${machine.itemsAvailable} items are loaded into the candy machine — finish loading below.`
                          : "The creator hasn't finished loading this drop's items yet."
                        : isCreator
                          ? "The phase is open, but no candy machine is deployed yet — deploy one below to start the mint."
                          : "The creator hasn't opened this drop for minting yet."}
                  </span>
                </div>
              )}

              {panelState === "live" && (
                <div style={{ marginTop: "var(--space-7)", paddingTop: "var(--space-6)", borderTop: "1px solid var(--border-subtle)" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
                      <Icon name={viewerId ? "check-circle" : "x-circle"} size={14} color={viewerId ? "var(--price-up)" : "var(--text-tertiary)"} />
                      <span style={{ fontSize: "var(--text-sm)", color: viewerId ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                        {viewerId ? "Wallet connected" : "Wallet not connected"}
                      </span>
                    </div>
                    {active?.allowlistOnly && (
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
                        <Icon name={allowlisted ? "check-circle" : "x-circle"} size={14} color={allowlisted ? "var(--price-up)" : "var(--text-tertiary)"} />
                        <span style={{ fontSize: "var(--text-sm)", color: allowlisted ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                          {allowlisted
                            ? `On allowlist${active.perWalletLimit != null ? ` · ${Math.max(0, active.perWalletLimit - viewerMintCount)} spot${active.perWalletLimit - viewerMintCount === 1 ? "" : "s"} left` : ""}`
                            : "Not on allowlist"}
                        </span>
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
                      <Icon name="check-circle" size={14} color="var(--price-up)" />
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>Items available</span>
                    </div>
                    <BalanceEligibilityLine requiredSol={headlinePrice} />
                  </div>
                </div>
              )}

              {panelState === "upcoming" && openDate && (
                <div style={{ marginTop: "var(--space-7)", paddingTop: "var(--space-6)", borderTop: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
                  <Icon name="clock" size={14} color="var(--text-tertiary)" />
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Mint opens {openDate}</span>
                </div>
              )}

              <div style={{ height: 6, background: "var(--surface-3)", borderRadius: 999, marginTop: "var(--space-8)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "var(--space-4)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                <span>{minted} / {total} minted</span>
                <span>{pct}%</span>
              </div>

              <div style={{ marginTop: "var(--space-8)" }}>
                <PendingMintNotice collectionId={id} />
                {panelState === "live" && machine && active?.groupLabel && collection.collection_address && creator?.wallet_address ? (
                  <CandyMintButton
                    collectionId={id}
                    collectionAddress={collection.collection_address}
                    candyMachineAddress={machine.candyMachineAddress}
                    creatorWallet={creator.wallet_address}
                    allowlist={allowlist}
                    phase={{
                      id: active.id,
                      name: active.name,
                      priceLamports: active.priceLamports.toString(),
                      startsAt: active.startsAt,
                      endsAt: active.endsAt,
                      perWalletLimit: active.perWalletLimit,
                      allowlistOnly: active.allowlistOnly,
                      position: 0,
                      groupLabel: active.groupLabel,
                    }}
                    viewerId={viewerId}
                    disabledReason={disabledReason}
                    available={candyAvailable}
                    perWalletRemaining={active.perWalletLimit != null ? Math.max(0, active.perWalletLimit - viewerMintCount) : null}
                    royaltyBps={collection.royalty_bps ?? 0}
                    revealAt={collection.reveal_at ?? null}
                    solUsd={solUsd}
                  />
                ) : panelState === "live" ? null : panelState === "upcoming" ? (
                  <RemindMe collectionId={id} name={collection.name} />
                ) : panelState === "draft" || panelState === "unlisted" ? null : (
                  <Link href={`/collections/${id}`} style={{ textDecoration: "none" }}>
                    <Button variant="primary" block iconRight="arrow-right">Trade on secondary</Button>
                  </Link>
                )}
              </div>

              {panelState === "live" && active?.perWalletLimit != null && (
                <div style={{ marginTop: "var(--space-6)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  Limit {active.perWalletLimit} per wallet{viewerId ? ` · you've minted ${viewerMintCount}` : ""}
                </div>
              )}
            </Card>

            {phases.length > 0 && (
            <Card padding={0}>
              {phases.map((p, i) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", padding: "var(--space-6) var(--space-7)", borderBottom: i === phases.length - 1 ? "none" : "1px solid var(--border-subtle)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, flex: "0 0 auto", background: DOT[p.status], boxShadow: p.status === "live" ? "var(--glow-live)" : undefined }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)", color: p.status === "ended" ? "var(--text-tertiary)" : "var(--text-primary)" }}>
                      {p.name}
                      {p.allowlistOnly ? <Icon name="lock" size={12} color="var(--text-tertiary)" /> : null}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", marginTop: 2 }}>
                      {new Date(p.startsAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      {p.perWalletLimit != null ? ` · ${p.perWalletLimit}/wallet` : ""}
                    </div>
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-md)", color: "var(--text-secondary)" }}>{p.priceSol} SOL</span>
                </div>
              ))}
            </Card>
            )}

            {phases.length > 0 && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-4)", padding: "0 var(--space-2)" }}>
                <Icon
                  name={machine ? "shield-check" : "info"}
                  size={13}
                  color={machine ? "var(--price-up)" : "var(--text-tertiary)"}
                  style={{ position: "relative", top: 2 }}
                />
                <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", textWrap: "pretty" }}>
                  {machine
                    ? "Enforced on chain. Price, mint window, per-wallet limit and allowlist are candy guards — the program rejects a mint that breaks them, whatever any app says."
                    : "Not deployed yet. These phases become candy guards when the creator deploys the candy machine; until then nothing can be minted."}
                </span>
              </div>
            )}
          </div>
        </div>

        {viewerOwnedIds.size > 0 && (
          <section style={{ marginTop: "var(--space-11)", paddingTop: "var(--space-9)", borderTop: "1px solid var(--border-subtle)" }}>
            <h2 className="sol-label" style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>Offers on this drop</h2>
            <p style={{ font: "var(--type-body-sm)", color: "var(--text-tertiary)", margin: "0 0 var(--space-8)", maxWidth: 620 }}>
              Accepting doesn&apos;t move funds — the bidder then pays and the item transfers. You can only accept a
              bid on an item you own and have listed.
            </p>
            <Card padding={0} style={{ maxWidth: 760 }}>
              <OffersList offers={dropOffers} viewerId={viewerId} isOwner={false} nftId={bindableNftId} />
            </Card>
          </section>
        )}

        {isCreator && (
          <section style={{ marginTop: "var(--space-11)", paddingTop: "var(--space-9)", borderTop: "1px solid var(--border-subtle)" }}>
            <h2 className="sol-label" style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-md)", color: "var(--text-primary)" }}>Manage your drop</h2>
            <p style={{ font: "var(--type-body-sm)", color: "var(--text-tertiary)", margin: "0 0 var(--space-8)", maxWidth: 620 }}>
              {machine
                ? "Your phases are enforced on chain by candy guards. Edit them below, then sync so the chain follows — until you do, the guards keep enforcing what you last deployed."
                : "Deploy a candy machine to open this drop. Your phases become candy guards, and buyers mint straight from the chain — nothing is minted until they do."}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: "var(--space-10)", alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-9)" }}>
                <CandyMachinePanel
                  collectionId={id}
                  collectionName={collection.name}
                  description={collection.description ?? null}
                  collectionAddress={collection.collection_address ?? null}
                  creatorId={collection.creator_id}
                  creatorWallet={creator?.wallet_address ?? null}
                  imageUrl={collection.cover_url ?? null}
                  revealAt={collection.reveal_at ?? null}
                  phases={serializedPhases}
                  allowlist={allowlist}
                  machine={machine}
                  hasMintedItems={items.length > 0}
                  defaultSupply={supplyParam}
                />
                <RevealPanel collectionId={id} revealAt={collection.reveal_at ?? null} now={now} />
              </div>
              <div>
                <div className="sol-label" style={{ marginBottom: "var(--space-6)" }}>Mint phases &amp; allowlist</div>
                <LaunchpadSetup
                  collections={[{ id: collection.id, name: collection.name }]}
                  userId={viewerId!}
                  onChainDrop={Boolean(machine)}
                />
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

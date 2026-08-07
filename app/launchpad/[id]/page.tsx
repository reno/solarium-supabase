import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { ArtTile, Badge, Button, Card, Icon } from "@/components/design";
import { BulkListButton } from "@/components/launchpad/bulk-list-button";
import { CandyMachineSetup } from "@/components/launchpad/candy-machine-setup";
import { Countdown } from "@/components/launchpad/countdown";
import { BalanceEligibilityLine } from "@/components/launchpad/mint-eligibility";
import { LaunchpadMintButton } from "@/components/launchpad/launchpad-mint-button";
import { RemindMe } from "@/components/launchpad/remind-me";
import { LaunchpadSetup } from "@/components/launchpad/launchpad-setup";
import { MyNftCard, type OwnedNft } from "@/components/listings/my-nft-card";
import { OffersList } from "@/components/offers/offers-list";
import { mapCollectionOffers, mapOffers, type OfferEntry, type RawCollectionOffer, type RawOffer } from "@/lib/offers/map";
import { serverNow } from "@/lib/format/relative-time";
import { shortWallet } from "@/lib/format/wallet";
import { countdownTarget, resolvePhases, type RawPhase } from "@/lib/launchpad/launchpad";
import { getSolUsd } from "@/lib/price/sol";
import { lamportsToSol } from "@/lib/solana/lamports";
import { createClient } from "@/lib/supabase/server";

const DOT: Record<string, string> = {
  live: "var(--live)",
  ended: "var(--text-disabled)",
  upcoming: "var(--border-strong)",
};

// Where a candy machine's `solFixedFee` guard sends the platform's cut. Unset (local dev, a
// self-hosted deployment) simply means no fee guard — the drop still deploys and mints.
const TREASURY_WALLET = process.env.NEXT_PUBLIC_SETTLEMENT_AUTHORITY || null;
// Matches FEE_BPS in the settle function, so a primary mint and a secondary sale take the same cut.
const FEE_BPS = 200;

export default async function LaunchpadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: collection } = await supabase
    .from("collections")
    .select(
      "id, name, description, cover_url, collection_address, creator_id, royalty_bps, reveal_at, candy_machine_address, candy_guard_address, cm_items_available, cm_items_loaded, creator:profiles!collections_creator_id_fkey(username, wallet_address)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!collection) notFound();

  const [phasesResult, editionsResult, viewerProfileResult] = await Promise.all([
    supabase.from("mint_phases").select("*").eq("collection_id", id),
    supabase
      .from("nfts")
      .select("id, name, image_url, asset_address, edition_number, owner_id, listings(id, price_lamports, status, seller_id, buyer_id)")
      .eq("collection_id", id)
      .order("edition_number", { ascending: true }),
    user ? supabase.from("profiles").select("wallet_address").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const rawPhases = (phasesResult.data ?? []) as RawPhase[];
  const viewerId = user?.id ?? null;
  const isCreator = viewerId === collection.creator_id;
  // A collection with no mint phases isn't a public launchpad yet. Its creator can still
  // reach this page to finish setup (add phases, list items) rather than hitting a 404 —
  // this is the bridge from minting a drop to opening it.
  const isDraft = rawPhases.length === 0;
  if (isDraft && !isCreator) notFound();
  const { phases, active } = resolvePhases(rawPhases);
  const creator = Array.isArray(collection.creator) ? collection.creator[0] : collection.creator;

  // A candy-machine drop keeps its supply on chain rather than in pre-minted rows, so the whole
  // progress/eligibility calculation below has a second source. `isCandyMachine` is the switch.
  const isCandyMachine = !!collection.candy_machine_address;
  const cmItemsAvailable = collection.cm_items_available ?? 0;
  const cmItemsLoaded = collection.cm_items_loaded ?? 0;

  const editions = editionsResult.data ?? [];
  // Listing-backed: an edition is "minted" once it leaves the creator. Candy machine: nothing
  // exists until someone mints it, so the count of recorded mints *is* the count minted.
  const [cmMintedResult, cmViewerMintedResult] = isCandyMachine
    ? await Promise.all([
        supabase
          .from("candy_machine_mints")
          .select("id", { count: "exact", head: true })
          .eq("collection_id", id),
        viewerId
          ? supabase
              .from("candy_machine_mints")
              .select("id", { count: "exact", head: true })
              .eq("collection_id", id)
              .eq("minter_id", viewerId)
          : Promise.resolve({ count: 0 }),
      ])
    : [{ count: 0 }, { count: 0 }];

  const total = isCandyMachine ? cmItemsAvailable : editions.length;
  const minted = isCandyMachine
    ? (cmMintedResult.count ?? 0)
    : editions.filter((e) => e.owner_id && e.owner_id !== collection.creator_id).length;
  const pct = total ? Math.round((minted / total) * 100) : 0;

  // Next mintable edition: a creator-owned edition with an active listing, lowest number.
  // The buyer pays that listing's price (the phase price is a creator-set target shown in
  // the phase list; the headline uses the actual next-edition price).
  let nextListingId: string | null = null;
  let nextPriceSol: string | null = null;
  const availableListingIds: string[] = [];
  // Items the creator still holds. Nothing mintable while this is > 0 means the supply was never
  // listed — a different state from every item having been bought, and the difference is what
  // separates "the creator hasn't opened the drop" from "sold out".
  let creatorHeld = 0;
  for (const e of editions) {
    if (e.owner_id !== collection.creator_id) continue;
    creatorHeld += 1;
    const activeL = (e.listings ?? []).find((l: { status: string }) => l.status === "active");
    if (activeL) {
      availableListingIds.push(activeL.id);
      if (nextListingId === null) {
        nextListingId = activeL.id;
        nextPriceSol = lamportsToSol(BigInt(String(activeL.price_lamports)));
      }
    }
  }

  // Viewer's prior mints in this collection. On a listing-backed drop this is the advisory basis
  // for the per-wallet limit; on a candy machine it only *displays* the tally — the mintLimit
  // guard's own counter is what actually stops an over-limit mint, and it counts per phase.
  const viewerMintCount = !viewerId
    ? 0
    : isCandyMachine
      ? (cmViewerMintedResult.count ?? 0)
      : editions.reduce(
          (n, e) => n + (e.listings ?? []).filter((l: { status: string; buyer_id: string | null }) => l.status === "sold" && l.buyer_id === viewerId).length,
          0
        );

  const viewerWallet = viewerProfileResult.data?.wallet_address ?? null;
  // The full list, not just "is the viewer on it": the allowList guard checks a merkle proof, and
  // a proof can only be built from every leaf that went into the root at deploy time. Fetched for
  // the creator too, since deploying computes the same root.
  const needsAllowlist = isCandyMachine ? isCreator || !!active?.allowlistOnly : false;
  const allowlistWallets: string[] = needsAllowlist
    ? ((
        await supabase
          .from("launchpad_allowlist")
          .select("wallet_address")
          .eq("collection_id", id)
          .order("wallet_address", { ascending: true })
      ).data ?? []).map((r: { wallet_address: string }) => r.wallet_address)
    : [];

  let allowlisted = true;
  if (active?.allowlistOnly && viewerWallet) {
    if (needsAllowlist) {
      allowlisted = allowlistWallets.includes(viewerWallet);
    } else {
      const { count } = await supabase
        .from("launchpad_allowlist")
        .select("wallet_address", { count: "exact", head: true })
        .eq("collection_id", id)
        .eq("wallet_address", viewerWallet);
      allowlisted = (count ?? 0) > 0;
    }
  } else if (active?.allowlistOnly) {
    allowlisted = false;
  }

  // Items on chain but not all written yet. A candy machine in this state cannot mint at all —
  // the chain rejects an unwritten config line — so it is the candy-machine analogue of a supply
  // that was minted but never listed: open phase, nothing to sell.
  const cmIncomplete = isCandyMachine && cmItemsLoaded < cmItemsAvailable;
  const cmRemaining = isCandyMachine ? Math.max(0, cmItemsAvailable - minted) : 0;

  // Nothing to mint, but for two opposite reasons: the supply isn't open, or it all sold.
  const nothingListed = isCandyMachine ? cmIncomplete : !nextListingId && creatorHeld > 0;
  const nothingAvailable = isCandyMachine ? cmRemaining === 0 || cmIncomplete : !nextListingId;

  // Gate for the mint button. Advisory on a listing-backed drop; on a candy machine the same
  // rules are guards, so this only saves the buyer a rejected transaction.
  let disabledReason: string | null = null;
  if (!active || active.status !== "live") disabledReason = "Mint not live";
  else if (viewerId === collection.creator_id) disabledReason = "You're the creator";
  else if (active.allowlistOnly && !allowlisted) disabledReason = "Allowlist only";
  else if (active.perWalletLimit != null && viewerMintCount >= active.perWalletLimit) disabledReason = "Wallet limit reached";
  else if (nothingListed) disabledReason = isCandyMachine ? "Not open yet" : "Not listed yet";
  else if (nothingAvailable) disabledReason = "Sold out";
  else if (isCandyMachine && !active.guardLabel) {
    // The phase was added after the machine was deployed, so no guard group carries its rules —
    // the chain has nothing to enforce and would reject the mint on an unknown group.
    disabledReason = "Phase not synced on chain";
  }

  const target = countdownTarget(active);
  // Rendered by the server and reused as the hydration snapshot, so the countdown starts correct.
  const now = serverNow();
  const headlinePrice = nextPriceSol ?? active?.priceSol ?? "—";
  const solUsd = await getSolUsd();

  // The launch states drive different panels (D§5):
  //   live      → price + eligibility + mint
  //   upcoming  → starts-in countdown + open date, mint locked
  //   unlisted  → phase is open but the supply was never listed → nothing to mint yet
  //   soldout   → every item minted → trade on secondary
  //   ended     → mint window closed with items unsold → closing % + secondary
  type PanelState = "draft" | "live" | "upcoming" | "unlisted" | "soldout" | "ended";
  const mintable = isCandyMachine ? !nothingAvailable : !!nextListingId;
  const panelState: PanelState = isDraft
    ? "draft"
    : !active || active.status === "ended"
      ? "ended"
      : active.status === "upcoming"
        ? "upcoming"
        : mintable
          ? "live"
          : nothingListed
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

  // Everything the buyer's wallet needs to call `mintV1` itself. Null on a listing-backed drop, or
  // on a candy machine whose active phase never became a guard group — in both cases the button
  // falls back to (or stays on) the listing path rather than sending a mint the chain will reject.
  const candyMachineSource =
    isCandyMachine && collection.candy_guard_address && collection.collection_address && active?.guardLabel
      ? {
          collectionId: id,
          candyMachine: collection.candy_machine_address as string,
          candyGuard: collection.candy_guard_address as string,
          collectionAddress: collection.collection_address as string,
          creatorWallet: creator?.wallet_address ?? "",
          treasuryWallet: TREASURY_WALLET,
          guardLabel: active.guardLabel,
          allowlist: active.allowlistOnly ? allowlistWallets : null,
          itemsRemaining: cmRemaining,
        }
      : null;

  const creatorEditions: OwnedNft[] = isCreator
    ? editions
        .filter((e) => e.owner_id === collection.creator_id)
        .map((e) => {
          const al = (e.listings ?? []).find((l: { status: string }) => l.status === "active");
          return {
            id: e.id,
            name: e.name,
            imageUrl: e.image_url,
            assetAddress: e.asset_address,
            collectionId: id,
            collectionAddress: collection.collection_address ?? null,
            listing: al ? { id: al.id, priceLamports: String(al.price_lamports) } : null,
          };
        })
    : [];
  const unlistedEditions = creatorEditions.filter((e) => !e.listing);

  // Bids on this drop, so a holder can accept without opening each item in turn. Covers offers on
  // individual items plus collection-wide offers; only the rows the viewer can actually settle
  // (they own that item, or — for a collection offer — they own a listed one) get an Accept.
  const viewerOwnedIds = new Set(viewerId ? editions.filter((e) => e.owner_id === viewerId).map((e) => e.id) : []);
  const bindableNftId =
    editions.find((e) => viewerOwnedIds.has(e.id) && (e.listings ?? []).some((l: { status: string }) => l.status === "active"))?.id ?? null;

  const [itemOffersRes, collectionOffersRes] = viewerOwnedIds.size
    ? await Promise.all([
        supabase
          .from("offers")
          .select("id, nft_id, bidder_id, price_lamports, expires_at, status, accepted_tx, nft:nfts(name, owner_id, listings(status)), bidder:profiles!offers_bidder_id_fkey(username, wallet_address)")
          .in("nft_id", editions.map((e) => e.id))
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

              {/* Draft / unlisted: nothing to mint. Tell the creator what's missing; tell everyone
                  else that the drop simply isn't open, rather than implying it sold out. */}
              {(panelState === "draft" || panelState === "unlisted") && (
                <div style={{ marginTop: "var(--space-7)", paddingTop: "var(--space-6)", borderTop: "1px solid var(--border-subtle)", display: "flex", alignItems: "flex-start", gap: "var(--space-4)" }}>
                  <Icon name="info" size={14} color="var(--text-tertiary)" style={{ position: "relative", top: 2 }} />
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", textWrap: "pretty" }}>
                    {panelState === "draft"
                      ? isCandyMachine
                        ? "Add a mint phase, then sync it to the candy machine to open this drop."
                        : "Add a mint phase and list your items below to open this drop."
                      : isCandyMachine
                        ? isCreator
                          ? `The phase is open, but only ${cmItemsLoaded} of ${cmItemsAvailable} items are written on chain — nobody can mint until they all are. Resume the upload below.`
                          : "The creator is still writing this drop's items on chain."
                        : isCreator
                          ? `The phase is open, but none of your ${creatorHeld} items are listed — list them below to start the mint.`
                          : "The creator hasn't put this drop's items up for mint yet."}
                  </span>
                </div>
              )}

              {/* Eligibility check (live only) */}
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
                    {/* The live panel only renders when something is mintable, so this line is
                        always a pass — "nothing available" has its own panel states now. */}
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
                      <Icon name="check-circle" size={14} color="var(--price-up)" />
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>Items available</span>
                    </div>
                    <BalanceEligibilityLine requiredSol={headlinePrice} />
                  </div>
                </div>
              )}

              {/* Upcoming: when the mint opens */}
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
                <span>{minted} / {total} {isCandyMachine ? "minted" : "sold"}</span>
                <span>{pct}%</span>
              </div>

              <div style={{ marginTop: "var(--space-8)" }}>
                {panelState === "live" ? (
                  <LaunchpadMintButton
                    availableListingIds={availableListingIds}
                    candyMachine={candyMachineSource}
                    priceSol={headlinePrice}
                    viewerId={viewerId}
                    disabledReason={disabledReason}
                    perWalletRemaining={active?.perWalletLimit != null ? Math.max(0, active.perWalletLimit - viewerMintCount) : null}
                    phaseName={active?.name ?? null}
                    royaltyBps={collection.royalty_bps ?? 0}
                    revealAt={collection.reveal_at ?? null}
                    solUsd={solUsd}
                  />
                ) : panelState === "upcoming" ? (
                  <RemindMe collectionId={id} name={collection.name} />
                ) : panelState === "draft" || panelState === "unlisted" ? null : (
                  <Link href={`/series/${id}`} style={{ textDecoration: "none" }}>
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
          </div>
        </div>

        {/* Shown to anyone holding items here, even with no bids yet — otherwise the place to
            accept a bid only exists once one arrives, which is where people go looking for it. */}
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
              {isCandyMachine
                ? "This drop mints from a candy machine — your phases are on-chain guards, so there is nothing to pre-mint or list. Buyers mint straight from the machine."
                : "List items to make them mintable — the price is prefilled to the active phase’s price, so buyers mint at the phase price. Configure your mint phases and allowlist on the right."}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: "var(--space-10)", alignItems: "start" }}>
              <div>
                <div className="sol-label" style={{ marginBottom: "var(--space-6)" }}>
                  {isCandyMachine ? "On-chain drop" : "List items"}
                </div>
                {/* The candy-machine panel replaces listing entirely once deployed, and offers the
                    deployment before that — but only for a drop with nothing pre-minted, since a
                    collection whose supply is already in the creator's wallet is the listing model
                    and switching would strand those items. */}
                {isCandyMachine || editions.length === 0 ? (
                  <CandyMachineSetup
                    collectionId={collection.id}
                    collectionName={collection.name}
                    collectionAddress={collection.collection_address ?? null}
                    royaltyBps={collection.royalty_bps ?? 0}
                    feeBps={FEE_BPS}
                    treasuryWallet={TREASURY_WALLET}
                    phases={phases.map((p) => ({
                      id: p.id,
                      position: p.position,
                      priceLamports: p.priceLamports,
                      startsAt: p.startsAt,
                      endsAt: p.endsAt,
                      perWalletLimit: p.perWalletLimit,
                      allowlistOnly: p.allowlistOnly,
                    }))}
                    allowlist={allowlistWallets}
                    state={{
                      candyMachineAddress: collection.candy_machine_address ?? null,
                      itemsAvailable: cmItemsAvailable,
                      itemsLoaded: cmItemsLoaded,
                    }}
                  />
                ) : (
                  <>
                    {unlistedEditions.length > 0 && (
                      <div style={{ marginBottom: "var(--space-7)", padding: "var(--space-6)", borderRadius: "var(--radius-card)", border: "1px solid var(--border-subtle)", background: "var(--surface-inset)" }}>
                        <BulkListButton nfts={unlistedEditions} userId={viewerId!} defaultPrice={active?.priceSol ?? undefined} />
                      </div>
                    )}
                    {creatorEditions.length === 0 ? (
                      <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-tertiary)" }}>No unsold items in your wallet.</p>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "var(--grid-gap)" }}>
                        {creatorEditions.map((nft) => (
                          <MyNftCard key={nft.id} nft={nft} userId={viewerId!} defaultPrice={active?.priceSol ?? undefined} royaltyBps={collection.royalty_bps ?? 0} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div>
                <div className="sol-label" style={{ marginBottom: "var(--space-6)" }}>Mint phases &amp; allowlist</div>
                <LaunchpadSetup
                  collections={[{ id: collection.id, name: collection.name }]}
                  userId={viewerId!}
                  onChainDrop={isCandyMachine}
                />
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

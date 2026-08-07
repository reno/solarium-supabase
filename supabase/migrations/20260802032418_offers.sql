-- Soft offers (bids). No escrow: an offer is a DB row expressing intent to buy at a
-- price until it expires. Funds stay in the bidder's wallet; when the seller accepts,
-- settlement builds an atomic transfer+payment that the bidder signs (see the offers
-- accept edge function). Because nothing is locked, offers are "soft" — a bidder can
-- fail to complete at accept time, so acceptance yields a pending sale, not a guarantee.

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  nft_id uuid not null references public.nfts (id) on delete cascade,
  bidder_id uuid not null references public.profiles (id) on delete cascade,
  price_lamports bigint not null check (price_lamports > 0),
  status text not null default 'active'
    check (status in ('active', 'accepted', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  accepted_tx text,                         -- settlement signature once accepted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One standing active offer per (nft, bidder); re-bidding replaces via cancel + insert.
create unique index offers_one_active_per_bidder
  on public.offers (nft_id, bidder_id) where (status = 'active');
create index offers_nft_idx on public.offers (nft_id);
create index offers_bidder_idx on public.offers (bidder_id);
create index offers_status_idx on public.offers (status);

alter table public.offers enable row level security;

create policy "offers are publicly readable"
  on public.offers for select using (true);

-- Bidders may offer on NFTs they don't own.
create policy "bidders can place offers"
  on public.offers for insert with check (
    auth.uid() = bidder_id
    and not exists (
      select 1 from public.nfts
      where nfts.id = nft_id and nfts.owner_id = auth.uid()
    )
  );

-- Bidders may only cancel their own active offers; marking accepted/expired is the
-- accept flow's job (service role), mirroring how listings are marked sold.
create policy "bidders can cancel their own offers"
  on public.offers for update
  using (auth.uid() = bidder_id and status = 'active')
  with check (status = 'cancelled');

create trigger offers_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();

-- Data API exposure (auto_expose_new_tables is off — new tables need explicit grants).
-- The base migration's `grant all … to service_role` only covered tables that existed
-- then, so this new table must grant the settlement edge function (service role) itself.
grant select on table public.offers to anon, authenticated;
grant insert, update on table public.offers to authenticated;
grant all on table public.offers to service_role;

-- Let the activity feed record bids (the design's ActivityRow has a "bid" kind).
alter table public.activities drop constraint activities_type_check;
alter table public.activities add constraint activities_type_check
  check (type in ('mint', 'sale', 'gift', 'list', 'delist', 'bid'));

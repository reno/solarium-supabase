-- offers (bids). Soft: no escrow. An offer is a row expressing intent to buy at a price until
-- it expires; funds stay in the bidder's wallet. When the owner accepts, settlement builds an
-- atomic transfer+payment the bidder signs — so acceptance yields a pending sale, not a
-- guarantee.
--
-- An offer targets EITHER one item (nft_id) or a whole collection with a quantity
-- (collection_id). Accepting a collection offer binds it to the item being sold, so a closed
-- collection offer legitimately carries both columns; only standing offers are exclusive.

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  nft_id uuid references public.nfts (id) on delete cascade,
  collection_id uuid references public.collections (id) on delete cascade,
  bidder_id uuid not null references public.profiles (id) on delete cascade,
  price_lamports bigint not null check (price_lamports > 0),
  quantity integer not null default 1 check (quantity >= 1),
  status text not null default 'active'
    check (status in ('active', 'accepted', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  accepted_tx text,                                      -- settlement signature once accepted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offers_one_target check (
    case
      -- Standing (unbound) offers: exactly one target, never both or neither.
      when status = 'active' then (nft_id is null) <> (collection_id is null)
      -- Bound/closed offers: a collection offer gains an nft_id when accepted.
      else nft_id is not null or collection_id is not null
    end
  )
);

-- One standing active offer per (nft, bidder) and per (collection, bidder); re-bidding
-- replaces via cancel + insert.
create unique index offers_one_active_per_bidder
  on public.offers (nft_id, bidder_id) where (status = 'active');
create unique index offers_one_active_collection_per_bidder
  on public.offers (collection_id, bidder_id) where (status = 'active' and collection_id is not null);
create index offers_nft_idx on public.offers (nft_id);
create index offers_collection_idx on public.offers (collection_id);
create index offers_bidder_idx on public.offers (bidder_id);
create index offers_status_idx on public.offers (status);

alter table public.offers enable row level security;

create policy "offers are publicly readable"
  on public.offers for select using (true);

-- Bidders may only offer on NFTs they don't own.
create policy "bidders can place offers"
  on public.offers for insert with check (
    auth.uid() = bidder_id
    and not exists (
      select 1 from public.nfts
      where nfts.id = nft_id and nfts.owner_id = auth.uid()
    )
  );

-- Bidders may only cancel their own active offers; marking accepted/expired is the accept
-- flow's job (service role), mirroring how listings are marked sold.
create policy "bidders can cancel their own offers"
  on public.offers for update
  using (auth.uid() = bidder_id and status = 'active')
  with check (status = 'cancelled');

create trigger offers_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();

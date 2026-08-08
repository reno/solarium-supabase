-- listings — off-chain. Creating or cancelling a listing touches no chain state: the NFT stays
-- in the seller's wallet, pre-authorized for transfer via Core's transfer delegate. Price lives
-- only here, so repricing needs no chain action at all.
--
-- A listing is truly active only while status='active' AND (expires_at is null OR expires_at >
-- now); reads use activeListing() in lib/listings/active.ts. Production would also flip expired
-- rows to 'cancelled' via a scheduled job.

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  nft_id uuid not null references public.nfts (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  price_lamports bigint not null check (price_lamports > 0),
  status text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
  buyer_id uuid references public.profiles (id) on delete set null,
  sale_tx text,                                          -- settlement transaction signature
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index listings_one_active_per_nft
  on public.listings (nft_id) where (status = 'active');
create index listings_seller_idx on public.listings (seller_id);
create index listings_status_idx on public.listings (status);
create index listings_active_expiry_idx
  on public.listings (expires_at) where status = 'active';

alter table public.listings enable row level security;

create policy "listings are publicly readable"
  on public.listings for select using (true);

create policy "sellers can list their own nfts"
  on public.listings for insert with check (
    auth.uid() = seller_id
    and exists (
      select 1 from public.nfts
      where nfts.id = nft_id and nfts.owner_id = auth.uid()
    )
  );

-- Sellers may cancel, or reprice while leaving the listing active. Marking sold is settlement's
-- job (service role, which bypasses RLS) — buyer_id and sale_tx are kept out of the seller's
-- reach by the column-level grant in the grants migration.
create policy "sellers can cancel or reprice their own listings"
  on public.listings for update
  using (auth.uid() = seller_id and status = 'active')
  with check (auth.uid() = seller_id and status in ('active', 'cancelled'));

create trigger listings_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

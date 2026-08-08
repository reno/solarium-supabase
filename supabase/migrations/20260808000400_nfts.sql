-- nfts — one row per Core asset. A cache of chain state; the chain is the source of truth
-- for ownership, which is why settlement (service role) is the only thing that moves owner_id.
--
-- There is no "edition of N" concept: items are unique 1/1s, so the column that numbers an
-- item within its collection is `item_number` (it was once `edition_number`, from an editions
-- model the app no longer has).

create table public.nfts (
  id uuid primary key default gen_random_uuid(),
  asset_address text unique not null,                    -- Core asset address (base58)
  collection_id uuid references public.collections (id) on delete set null,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  -- cache of on-chain owner; the chain is the source of truth
  owner_id uuid references public.profiles (id) on delete set null,
  owner_wallet text,
  name text not null check (char_length(name) between 1 and 100),
  description text check (char_length(description) <= 2000),
  image_url text not null,
  metadata_url text not null,
  item_number integer check (item_number >= 1),
  mint_tx text not null,                                 -- transaction signature of the mint
  -- Per-item attributes, read from the item's metadata JSON when the mint is recorded.
  -- rarity_* are derived from them by recompute_collection_rarity().
  traits jsonb not null default '[]'::jsonb,
  rarity_rank integer,
  rarity_total integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.nfts.item_number is
  'Item number within its collection (mint index), e.g. 3 → "Name #3". Null for a standalone 1/1.';

create index nfts_collection_idx on public.nfts (collection_id);
create index nfts_owner_idx on public.nfts (owner_id);
create index nfts_creator_idx on public.nfts (creator_id);

alter table public.nfts enable row level security;

create policy "nfts are publicly readable"
  on public.nfts for select using (true);

create policy "creators can record their own mints"
  on public.nfts for insert with check (auth.uid() = creator_id);

-- Ownership updates after sales go through edge functions (service role), which bypass RLS;
-- no general update policy on purpose. The one update a creator may make is recomputing rarity,
-- and what actually contains that is the column-level grant in the grants migration — this
-- policy only decides which rows.
create policy "creators can recompute rarity on their own items"
  on public.nfts for update
  using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);

create trigger nfts_updated_at
  before update on public.nfts
  for each row execute function public.set_updated_at();

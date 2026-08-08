-- collections — a Metaplex Core collection.
--
-- The model is generative: a collection is a supply of *unique* 1/1 items, each its own Core
-- asset with its own art and traits. "Supply" is just the count of its items.
--
-- Display stats are NOT stored here. Volume, the 24h delta and the 14-day sparkline are all
-- windowed quantities that go stale with the clock rather than with the data, so they are
-- computed on read by the collection_market_stats view (see 20260808001100_views_and_stats.sql).

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  collection_address text unique,                        -- on-chain Core collection address (base58)
  name text not null check (char_length(name) between 1 and 100),
  description text check (char_length(description) <= 2000),
  cover_url text,
  banner_url text,
  -- Creator royalty in basis points (500 = 5.0%), paid as its own lamport leg by the buyer.
  -- See supabase/functions/settle/index.ts for the split and its creator carve-out.
  royalty_bps integer not null default 500 check (royalty_bps between 0 and 10000),
  -- When set and in the future, items render as "unrevealed" until that time. Null = revealed.
  reveal_at timestamptz,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

comment on column public.collections.banner_url is
  'Banner image URL (6:1 aspect ratio), distinct from the 1:1 cover avatar';

comment on column public.collections.verified is
  'Vetting badge. Set out-of-band by the service role only — the authenticated UPDATE grant '
  'deliberately excludes this column so a creator cannot self-verify.';

-- creator_id is both an FK cascade target and the join key for every "my collections" query.
create index collections_creator_idx on public.collections (creator_id);

alter table public.collections enable row level security;

create policy "collections are publicly readable"
  on public.collections for select using (true);

create policy "creators can insert their own collections"
  on public.collections for insert with check (auth.uid() = creator_id);

-- WITH CHECK stops a creator from reassigning a collection to someone else. Which *columns*
-- they may write is settled by the column-level grant in the grants migration, not here.
create policy "creators can update their own collections"
  on public.collections for update
  using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);

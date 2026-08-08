-- activities — the mint / sale / list / delist / bid feed. Append-only for clients.
--
-- This table is also the input to every derived market number: collection_market_stats
-- aggregates it, filtered by type and windowed on created_at.

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  -- 'gift' is a plain Core transfer recorded by the app. No UI writes it today.
  type text not null check (type in ('mint', 'sale', 'gift', 'list', 'delist', 'bid')),
  nft_id uuid references public.nfts (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  counterparty_id uuid references public.profiles (id) on delete set null,
  lamports bigint check (lamports >= 0),
  tx_signature text,
  created_at timestamptz not null default now()
);

create index activities_nft_idx on public.activities (nft_id);
create index activities_actor_idx on public.activities (actor_id);
-- Every stats path filters type='sale' and windows on created_at; with the sparkline now
-- computed on read, this index is what keeps the home page's trending table cheap.
create index activities_type_created_idx on public.activities (type, created_at desc);

alter table public.activities enable row level security;

create policy "activities are publicly readable"
  on public.activities for select using (true);

create policy "users can record their own activities"
  on public.activities for insert with check (auth.uid() = actor_id);

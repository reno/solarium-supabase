-- Enforced launchpad drops via the Metaplex Core Candy Machine.
--
-- This supersedes the advisory model the 20260802153213 migration had to settle for. That
-- migration's note said the Candy Machine was incompatible with umi 1.5.1 because the package
-- peers `umi <= 1`; the peer range is stale, not a real incompatibility — mpl-core-candy-machine
-- 0.3.0 builds, deploys and mints against umi 1.5.1 (verified on devnet). So a drop can now be
-- enforced by the chain: phase windows, prices, per-wallet limits and allowlists become candy
-- guard groups, and a buyer who bypasses this app still can't mint outside their phase.
--
-- Both models coexist. A collection WITHOUT a candy_machines row keeps the old path (creator
-- pre-mints the supply and lists it; buyers "mint" = buy a listing, enforcement advisory).
-- A collection WITH one mints straight from the chain and never pre-mints.

create table public.candy_machines (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null unique references public.collections (id) on delete cascade,
  candy_machine_address text not null unique,           -- the candy machine account (base58)
  candy_guard_address text not null,                    -- its candy guard PDA
  authority_wallet text not null,                       -- creator wallet that owns the machine
  items_available integer not null check (items_available > 0),
  -- Caches of chain state, kept fresh by the mint recorder. The chain is the source of truth;
  -- these exist so a launchpad page can render supply without an RPC round trip per view.
  items_loaded integer not null default 0 check (items_loaded >= 0),
  items_redeemed integer not null default 0 check (items_redeemed >= 0),
  -- Config lines store name/uri as a shared prefix plus a per-item suffix, so both are needed
  -- to reconstruct what an item's metadata URL will be.
  prefix_name text not null default '',
  prefix_uri text not null default '',
  deploy_tx text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index candy_machines_collection_idx on public.candy_machines (collection_id);

alter table public.candy_machines enable row level security;

create policy "candy machines are publicly readable"
  on public.candy_machines for select using (true);

-- Only the collection's creator deploys or updates its machine. The row is a mirror of what
-- that creator just signed on chain, so no one else has any business writing it.
create policy "creators insert their candy machine"
  on public.candy_machines for insert with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );
create policy "creators update their candy machine"
  on public.candy_machines for update using (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );

create trigger candy_machines_updated_at
  before update on public.candy_machines
  for each row execute function public.set_updated_at();

-- Which candy guard group a phase became. Candy guard labels are a fixed 6 bytes on chain, so
-- the label can't just be the phase name; it's assigned at deploy time (p0, p1, …) and stored
-- here so a mint can name the group its phase corresponds to.
alter table public.mint_phases
  add column group_label text check (group_label is null or char_length(group_label) between 1 and 6);

create unique index mint_phases_group_label_idx
  on public.mint_phases (collection_id, group_label)
  where group_label is not null;

-- Data API exposure (auto_expose_new_tables is off — new tables need explicit grants,
-- including service_role, which the candy-mint function uses to record mints).
grant select on table public.candy_machines to anon, authenticated;
grant insert, update on table public.candy_machines to authenticated;
grant all on table public.candy_machines to service_role;

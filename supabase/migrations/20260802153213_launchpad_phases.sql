-- Launchpad = a phased drop over a collection. A collection with mint_phases is a
-- launchpad: the creator pre-mints the supply (existing mint flow), and buyers "mint" =
-- buy the next available edition at the current phase's price during that phase's window.
--
-- NOTE on enforcement: phase windows, per-wallet limits and allowlists are advisory on this
-- path — enforced at the app/DB layer, since a pre-minted, listing-backed drop has no on-chain
-- rule to break. The schema is deliberately shaped so a Candy Machine can take over enforcement
-- without a rewrite, and 20260807120000_candy_machine.sql does exactly that.
--
-- (An earlier version of this note claimed the Core Candy Machine was unusable here because its
-- package peers `umi >= 0.8.2 <= 1` against this project's umi 1.5.1. That was wrong: a peer
-- range is advisory, not a runtime incompatibility. See the later migration for the correction.)

create table public.mint_phases (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  price_lamports bigint not null check (price_lamports >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz,                                   -- null = open-ended
  per_wallet_limit integer check (per_wallet_limit is null or per_wallet_limit > 0),
  allowlist_only boolean not null default false,
  position integer not null default 0,                  -- display / sequence order
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create index mint_phases_collection_idx on public.mint_phases (collection_id);

alter table public.mint_phases enable row level security;

create policy "mint phases are publicly readable"
  on public.mint_phases for select using (true);

-- Only the collection's creator manages its phases.
create policy "creators insert their phases"
  on public.mint_phases for insert with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );
create policy "creators update their phases"
  on public.mint_phases for update using (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );
create policy "creators delete their phases"
  on public.mint_phases for delete using (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );

create trigger mint_phases_updated_at
  before update on public.mint_phases
  for each row execute function public.set_updated_at();

-- Allowlist entries for allowlist-only phases. Membership is public (allowlists usually
-- are), managed by the collection creator.
create table public.launchpad_allowlist (
  collection_id uuid not null references public.collections (id) on delete cascade,
  wallet_address text not null,
  created_at timestamptz not null default now(),
  primary key (collection_id, wallet_address)
);

alter table public.launchpad_allowlist enable row level security;

create policy "allowlist is publicly readable"
  on public.launchpad_allowlist for select using (true);
create policy "creators insert allowlist entries"
  on public.launchpad_allowlist for insert with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );
create policy "creators delete allowlist entries"
  on public.launchpad_allowlist for delete using (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );

-- Data API exposure (auto_expose_new_tables is off — new tables need explicit grants,
-- including service_role for any edge-function access).
grant select on table public.mint_phases, public.launchpad_allowlist to anon, authenticated;
grant insert, update, delete on table public.mint_phases to authenticated;
grant insert, delete on table public.launchpad_allowlist to authenticated;
grant all on table public.mint_phases, public.launchpad_allowlist to service_role;

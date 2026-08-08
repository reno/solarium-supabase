-- mint_phases + launchpad_allowlist — a phased drop over a collection.
--
-- Each phase becomes a candy guard group on chain when the creator deploys the collection's
-- candy machine: price, window, per-wallet limit and allowlist merkle root are enforced by the
-- program, not by this app. The rows here are what the deploy is built from, and what the
-- launchpad page renders.

create table public.mint_phases (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  price_lamports bigint not null check (price_lamports >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz,                                   -- null = open-ended
  per_wallet_limit integer check (per_wallet_limit is null or per_wallet_limit > 0),
  allowlist_only boolean not null default false,
  position integer not null default 0,                   -- display / sequence order
  -- Which candy guard group this phase became. Guard labels are a fixed 6 bytes on chain, so
  -- the label can't be the phase name; it's assigned at deploy time (p0, p1, …) and stored here
  -- so a mint can name the group its phase corresponds to.
  group_label text check (group_label is null or char_length(group_label) between 1 and 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create index mint_phases_collection_idx on public.mint_phases (collection_id);
create unique index mint_phases_group_label_idx
  on public.mint_phases (collection_id, group_label)
  where group_label is not null;

alter table public.mint_phases enable row level security;

create policy "mint phases are publicly readable"
  on public.mint_phases for select using (true);

-- Only the collection's creator manages its phases. The WITH CHECK matters as much as the
-- USING: without it an update could re-point collection_id at someone else's collection.
create policy "creators insert their phases"
  on public.mint_phases for insert with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );
create policy "creators update their phases"
  on public.mint_phases for update
  using (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  )
  with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );
create policy "creators delete their phases"
  on public.mint_phases for delete using (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );

create trigger mint_phases_updated_at
  before update on public.mint_phases
  for each row execute function public.set_updated_at();

-- Allowlist entries for allowlist-only phases. Membership is public (allowlists usually are),
-- managed by the collection creator, and hashed into a merkle root at deploy time.
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

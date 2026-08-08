-- collection_item_rarity — every item's rarity, settled before any of them mints.
--
-- recompute_collection_rarity() (20260808001100_views_and_stats.sql) ranks the rows in `nfts`,
-- and those only exist once a buyer has minted. Mid-drop its frequencies therefore describe
-- whatever fraction has sold: at 10% minted the denominators are a tenth of the collection, and
-- every rank churns until sellout. Ranks shown during a drop were noise.
--
-- A candy machine mints each config line exactly once, so the full trait distribution is fixed
-- the moment the creator uploads the manifest — rarity is a property of the pool, not of who
-- bought what. This table is that distribution, ranked once by rankManifest() in
-- lib/launchpad/manifest.ts (which mirrors the SQL's formula) and looked up per item as it
-- mints. `candy-mint` prefers it and skips the recompute entirely when it finds a row.
--
-- Drops created before the manifest existed have no rows here and still fall back to
-- recompute_collection_rarity, unchanged.

create table public.collection_item_rarity (
  collection_id uuid not null references public.collections (id) on delete cascade,
  -- Matches nfts.item_number: the item's index within the collection, which is also the candy
  -- machine config line it gets minted from.
  item_number integer not null check (item_number >= 1),
  -- The same score the SQL computes — summed inverse trait frequency, higher is rarer. Stored
  -- so a rank can be explained rather than only asserted.
  rarity_score numeric not null,
  rarity_rank integer not null check (rarity_rank >= 1),
  rarity_total integer not null check (rarity_total >= 1),
  primary key (collection_id, item_number)
);

comment on table public.collection_item_rarity is
  'Planned per-item rarity for a manifest-based drop, ranked at creation time over the whole '
  'pool rather than over the items minted so far.';

alter table public.collection_item_rarity enable row level security;

-- Public, like every other read in this app: a drop's rarity table is the same information as
-- its metadata JSONs, which are already in a public bucket.
create policy "item rarity is publicly readable"
  on public.collection_item_rarity for select using (true);

-- Written once by the collection's creator, from the manifest they just uploaded.
create policy "creators insert their own item rarity"
  on public.collection_item_rarity for insert with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );

-- No update policy on purpose. Re-authoring a drop replaces its ranking wholesale; delete and
-- re-insert cannot leave two rankings interleaved the way a partial update could.
create policy "creators delete their own item rarity"
  on public.collection_item_rarity for delete using (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );

-- Grants for every table that predates this one live in 20260808001200_grants.sql. That
-- migration is applied, so this table's go here — same shape, deliberately not a blanket
-- update grant. service_role is already covered by that file's ALTER DEFAULT PRIVILEGES.
grant select on table public.collection_item_rarity to anon, authenticated;
grant insert, delete on table public.collection_item_rarity to authenticated;

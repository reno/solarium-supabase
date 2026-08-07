-- Candy-machine-backed launches.
--
-- Supersedes the note in 20260802153213_launchpad_phases.sql, which recorded that the
-- Metaplex Core Candy Machine was unusable here because `mpl-core-candy-machine` declares
-- `@metaplex-foundation/umi >= 0.8.2 <= 1` while this project runs umi 1.5.1. That is a
-- peer-*range* declaration, not a runtime incompatibility: pnpm resolves a single umi 1.5.1
-- and the package's instruction builders work against it unchanged. The programs themselves
-- are already deployed on devnet and mainnet and cost nothing to use:
--
--   Core Candy Machine  CMAGAKJ67e9hRZgfC5SFTbZH8MgEmtqazKXjmkaJjWTJ
--   Candy Guard         CMACYFENjoBMHzapRXyo1JZkVS6EtaDDzkjMrmQLvr4J
--
-- So a launch can now be one of two shapes, and both remain supported:
--
--   listing-backed  (the original)  the creator pre-mints the supply and lists it; "mint" is
--                                   a purchase settled by the `settle` function. Phase windows,
--                                   per-wallet limits and allowlists are advisory (app-side).
--   candy-machine   (this one)      the creator deploys a Candy Machine + Candy Guard; the
--                                   buyer's own wallet calls mintV1 and the *chain* enforces
--                                   the phase window, per-wallet limit, allowlist and price.
--
-- A collection is candy-machine-backed exactly when `candy_machine_address` is set.

alter table public.collections
  add column if not exists candy_machine_address text unique,
  add column if not exists candy_guard_address text,
  -- Item count the candy machine was created with, and how many config lines have been
  -- written so far. Loading config lines takes many transactions for a large drop, so the
  -- creator's upload has to be resumable across sessions — this is where it resumes from.
  add column if not exists cm_items_available integer not null default 0,
  add column if not exists cm_items_loaded integer not null default 0,
  add constraint collections_cm_items_loaded_range
    check (cm_items_loaded >= 0 and cm_items_loaded <= cm_items_available);

comment on column public.collections.candy_machine_address is
  'Core Candy Machine account. Non-null = this launch mints from the chain, not from listings.';
comment on column public.collections.candy_guard_address is
  'Candy Guard account wrapping the candy machine; holds the per-phase guard groups.';

-- Which Candy Guard group this phase became. Guard labels are a fixed 6-byte field on chain,
-- so the label is *not* the phase name — it is a short generated key (g0, g1, …) that the mint
-- client passes as `group` so the chain applies this phase's price, window and limits.
alter table public.mint_phases
  add column if not exists guard_label text
    check (guard_label is null or char_length(guard_label) between 1 and 6);

comment on column public.mint_phases.guard_label is
  'Candy Guard group label for this phase (<= 6 chars). Null on listing-backed launches.';

-- Records one candy-machine mint. Written only by the `launch-mint` edge function under the
-- service role, after it has verified the landed transaction and the asset's on-chain owner —
-- the same "never trust the client's claim that a tx landed" rule the settle function follows.
-- Its job is idempotency: the unique signature stops a replayed confirm double-recording a mint.
create table public.candy_machine_mints (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  nft_id uuid not null references public.nfts (id) on delete cascade,
  minter_id uuid not null references public.profiles (id) on delete cascade,
  asset_address text not null unique,
  signature text not null unique,
  price_lamports bigint not null default 0 check (price_lamports >= 0),
  phase_id uuid references public.mint_phases (id) on delete set null,
  created_at timestamptz not null default now()
);

create index candy_machine_mints_collection_idx on public.candy_machine_mints (collection_id);
create index candy_machine_mints_minter_idx on public.candy_machine_mints (collection_id, minter_id);

alter table public.candy_machine_mints enable row level security;

-- Public read: the launch page counts these to show mint progress and a wallet's own tally.
-- No insert/update/delete policy on purpose — the service role is the only writer.
create policy "candy machine mints are publicly readable"
  on public.candy_machine_mints for select using (true);

grant select on table public.candy_machine_mints to anon, authenticated;
grant all on table public.candy_machine_mints to service_role;

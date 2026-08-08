-- candy_machines — the enforced launchpad. A collection has a deployed Metaplex Core Candy
-- Machine + Candy Guard exactly when it has a row here, and that is the only drop shape the
-- app can create: the creator deploys the machine and loads one config line per item, buyers
-- call mintV1 from their own wallet, and the program enforces phase windows, prices, per-wallet
-- limits and allowlists.
--
-- Because `nfts` may only be inserted by a collection's creator, a buyer's mint is recorded by
-- the candy-mint edge function, which re-derives it from the chain rather than trusting the
-- client.

create table public.candy_machines (
  id uuid primary key default gen_random_uuid(),
  -- One machine per collection; the unique constraint is also this table's collection index.
  collection_id uuid not null unique references public.collections (id) on delete cascade,
  candy_machine_address text not null unique,            -- the candy machine account (base58)
  candy_guard_address text not null,                     -- its candy guard PDA
  authority_wallet text not null,                        -- creator wallet that owns the machine
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

alter table public.candy_machines enable row level security;

create policy "candy machines are publicly readable"
  on public.candy_machines for select using (true);

-- Only the collection's creator deploys or updates its machine. The row is a mirror of what
-- that creator just signed on chain, so no one else has any business writing it — and the
-- WITH CHECK stops an update from re-pointing the row at another collection.
create policy "creators insert their candy machine"
  on public.candy_machines for insert with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );
create policy "creators update their candy machine"
  on public.candy_machines for update
  using (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  )
  with check (
    exists (select 1 from public.collections c where c.id = collection_id and c.creator_id = auth.uid())
  );

create trigger candy_machines_updated_at
  before update on public.candy_machines
  for each row execute function public.set_updated_at();

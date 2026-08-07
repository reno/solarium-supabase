-- Vetted launches (DESIGN.md §6): creators submit a drop application (a signed message,
-- no SOL spent) that enters "pending review". Approval is out-of-band (admin / service
-- role); for now the row simply carries a status the creator can watch.

create table public.launch_applications (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text check (char_length(description) <= 2000),
  website text,
  twitter text,
  metadata_source text,                                  -- JSON / Arweave / IPFS
  supply integer check (supply is null or supply > 0),
  mint_price_lamports bigint check (mint_price_lamports is null or mint_price_lamports >= 0),
  royalty_bps integer check (royalty_bps is null or royalty_bps between 0 and 10000),
  per_wallet_limit integer check (per_wallet_limit is null or per_wallet_limit > 0),
  reveal_mode text,                                      -- instant / delayed
  phases jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index launch_applications_creator_idx on public.launch_applications (creator_id);

alter table public.launch_applications enable row level security;

-- Applications are private to their creator; approval flips status via the service role.
create policy "creators read their own applications"
  on public.launch_applications for select using (auth.uid() = creator_id);
create policy "creators submit their own applications"
  on public.launch_applications for insert with check (auth.uid() = creator_id);

grant select, insert on table public.launch_applications to authenticated;
grant all on table public.launch_applications to service_role;

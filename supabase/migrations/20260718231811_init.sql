-- Solarium initial schema.
-- Ownership and settlement live on-chain; these tables are the off-chain layer:
-- profiles/social graph (source of truth) and nft/listing rows (cache of chain state).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- base58 Solana address; populated from web3 auth metadata when available,
  -- otherwise set by the client right after first sign-in
  wallet_address text unique,
  username text unique check (username ~ '^[a-z0-9_]{3,30}$'),
  bio text check (char_length(bio) <= 500),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are publicly readable"
  on public.profiles for select using (true);

create policy "users can insert their own profile"
  on public.profiles for insert with check (auth.uid() = id);

create policy "users can update their own profile"
  on public.profiles for update using (auth.uid() = id);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row when a wallet signs in for the first time.
-- The wallet address location in metadata depends on the auth provider payload,
-- so fall back to null and let the client fill it in.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, wallet_address)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'address',
      new.raw_user_meta_data -> 'custom_claims' ->> 'address'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- collections (a Metaplex Core collection; edition sets live in one collection)
-- ---------------------------------------------------------------------------

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  collection_address text unique, -- on-chain Core collection address (base58)
  name text not null check (char_length(name) between 1 and 100),
  description text check (char_length(description) <= 2000),
  cover_url text,
  created_at timestamptz not null default now()
);

alter table public.collections enable row level security;

create policy "collections are publicly readable"
  on public.collections for select using (true);

create policy "creators can insert their own collections"
  on public.collections for insert with check (auth.uid() = creator_id);

create policy "creators can update their own collections"
  on public.collections for update using (auth.uid() = creator_id);

-- ---------------------------------------------------------------------------
-- nfts (one row per Core asset; editions are N rows sharing a collection)
-- ---------------------------------------------------------------------------

create table public.nfts (
  id uuid primary key default gen_random_uuid(),
  asset_address text unique not null,       -- Core asset address (base58)
  collection_id uuid references public.collections (id) on delete set null,
  creator_id uuid not null references public.profiles (id) on delete cascade,
  -- cache of on-chain owner; the chain is the source of truth
  owner_id uuid references public.profiles (id) on delete set null,
  owner_wallet text,
  name text not null check (char_length(name) between 1 and 100),
  description text check (char_length(description) <= 2000),
  image_url text not null,
  metadata_url text not null,
  edition_number integer check (edition_number >= 1),
  edition_total integer check (edition_total >= 1),
  mint_tx text not null,                    -- transaction signature of the mint
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index nfts_collection_idx on public.nfts (collection_id);
create index nfts_owner_idx on public.nfts (owner_id);
create index nfts_creator_idx on public.nfts (creator_id);

alter table public.nfts enable row level security;

create policy "nfts are publicly readable"
  on public.nfts for select using (true);

create policy "creators can record their own mints"
  on public.nfts for insert with check (auth.uid() = creator_id);

-- Ownership updates after sales/gifts go through edge functions (service role),
-- which bypass RLS; no general update policy on purpose.

create trigger nfts_updated_at
  before update on public.nfts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- listings (off-chain; one row per asset, "quantity" = active rows in a set)
-- ---------------------------------------------------------------------------

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  nft_id uuid not null references public.nfts (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  price_lamports bigint not null check (price_lamports > 0),
  status text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
  buyer_id uuid references public.profiles (id) on delete set null,
  sale_tx text,                             -- settlement transaction signature
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index listings_one_active_per_nft
  on public.listings (nft_id) where (status = 'active');
create index listings_seller_idx on public.listings (seller_id);
create index listings_status_idx on public.listings (status);

alter table public.listings enable row level security;

create policy "listings are publicly readable"
  on public.listings for select using (true);

create policy "sellers can list their own nfts"
  on public.listings for insert with check (
    auth.uid() = seller_id
    and exists (
      select 1 from public.nfts
      where nfts.id = nft_id and nfts.owner_id = auth.uid()
    )
  );

-- Sellers may only cancel; marking sold is settlement's job (service role).
create policy "sellers can cancel their own listings"
  on public.listings for update
  using (auth.uid() = seller_id and status = 'active')
  with check (status = 'cancelled');

create trigger listings_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- activities (mint / sale / gift / list / delist feed)
-- ---------------------------------------------------------------------------

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('mint', 'sale', 'gift', 'list', 'delist')),
  nft_id uuid references public.nfts (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  counterparty_id uuid references public.profiles (id) on delete set null,
  lamports bigint check (lamports >= 0),
  tx_signature text,
  created_at timestamptz not null default now()
);

create index activities_nft_idx on public.activities (nft_id);
create index activities_actor_idx on public.activities (actor_id);

alter table public.activities enable row level security;

create policy "activities are publicly readable"
  on public.activities for select using (true);

create policy "users can record their own activities"
  on public.activities for insert with check (auth.uid() = actor_id);

-- ---------------------------------------------------------------------------
-- social: follows, likes, comments
-- ---------------------------------------------------------------------------

create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index follows_followee_idx on public.follows (followee_id);

alter table public.follows enable row level security;

create policy "follows are publicly readable"
  on public.follows for select using (true);

create policy "users can follow"
  on public.follows for insert with check (auth.uid() = follower_id);

create policy "users can unfollow"
  on public.follows for delete using (auth.uid() = follower_id);

create table public.likes (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  nft_id uuid not null references public.nfts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, nft_id)
);

create index likes_nft_idx on public.likes (nft_id);

alter table public.likes enable row level security;

create policy "likes are publicly readable"
  on public.likes for select using (true);

create policy "users can like"
  on public.likes for insert with check (auth.uid() = profile_id);

create policy "users can unlike"
  on public.likes for delete using (auth.uid() = profile_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  nft_id uuid not null references public.nfts (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_nft_idx on public.comments (nft_id);

alter table public.comments enable row level security;

create policy "comments are publicly readable"
  on public.comments for select using (true);

create policy "users can comment"
  on public.comments for insert with check (auth.uid() = profile_id);

create policy "users can edit their own comments"
  on public.comments for update using (auth.uid() = profile_id);

create policy "users can delete their own comments"
  on public.comments for delete using (auth.uid() = profile_id);

create trigger comments_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- count views (query these instead of aggregating client-side)
-- ---------------------------------------------------------------------------

create view public.nft_like_counts
with (security_invoker = true) as
  select nft_id, count(*)::bigint as like_count
  from public.likes
  group by nft_id;

create view public.profile_follow_counts
with (security_invoker = true) as
  select
    p.id as profile_id,
    (select count(*) from public.follows f where f.followee_id = p.id)::bigint as follower_count,
    (select count(*) from public.follows f where f.follower_id = p.id)::bigint as following_count
  from public.profiles p;

-- ---------------------------------------------------------------------------
-- storage buckets
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values
  ('nft-media', 'nft-media', true),   -- images + metadata JSON; on-chain URIs point here
  ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Uploads are namespaced by user id: <bucket>/<auth.uid()>/...
create policy "public read of nft media"
  on storage.objects for select using (bucket_id in ('nft-media', 'avatars'));

create policy "users upload to their own folder"
  on storage.objects for insert with check (
    bucket_id in ('nft-media', 'avatars')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "users manage their own objects"
  on storage.objects for delete using (
    bucket_id in ('nft-media', 'avatars')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

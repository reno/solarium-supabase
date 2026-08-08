-- profiles — one row per authenticated wallet, keyed by auth.users.id.
-- The wallet address is the user's identity (Supabase web3 sign-in); there are no
-- email/password flows.

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

-- WITH CHECK as well as USING: a USING-only update policy says which rows you may touch,
-- not what they may become.
create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

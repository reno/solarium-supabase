-- social: follows, likes, comments. Ordinary Postgres tables under RLS — write your own rows,
-- read everything. No chain interaction. Counts come from the views in the next migration,
-- never from client-side aggregation.

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
  on public.comments for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "users can delete their own comments"
  on public.comments for delete using (auth.uid() = profile_id);

create trigger comments_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

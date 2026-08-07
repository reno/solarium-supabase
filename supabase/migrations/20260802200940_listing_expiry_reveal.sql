-- Listing expiry (real) + collection reveal (visualization).
--
-- listings.expires_at: a listing is only truly active while status='active' AND
-- (expires_at is null OR expires_at > now). Reads use the `activeListing()` helper (lib);
-- production would also flip expired rows to 'cancelled' via a scheduled job.
alter table public.listings add column if not exists expires_at timestamptz;
create index if not exists listings_active_expiry_idx
  on public.listings (expires_at) where status = 'active';

-- collections.reveal_at: when set and in the future, the collection's items are
-- "unrevealed" (placeholder art + a reveal countdown) until that time. Null = revealed.
alter table public.collections add column if not exists reveal_at timestamptz;

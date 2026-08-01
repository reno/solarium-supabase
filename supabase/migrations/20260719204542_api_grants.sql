-- Tables created in `public` are no longer auto-exposed to the Data API roles
-- (see auto_expose_new_tables in config.toml), so grant access explicitly.
-- RLS (enabled on every table) still controls which rows each role can touch;
-- these grants only open the table-level door.

grant usage on schema public to anon, authenticated, service_role;

-- Settlement and ownership sync run in edge functions with the service role.
grant all on all tables in schema public to service_role;

-- Everything is publicly readable (marketplace + social feeds).
grant select on table
  public.profiles,
  public.collections,
  public.nfts,
  public.listings,
  public.activities,
  public.follows,
  public.likes,
  public.comments,
  public.nft_like_counts,
  public.profile_follow_counts
to anon, authenticated;

-- Writes allowed per table; RLS policies scope them to the caller's own rows.
grant insert, update on table public.profiles to authenticated;
grant insert, update on table public.collections to authenticated;
grant insert on table public.nfts to authenticated;
grant insert, update on table public.listings to authenticated;
grant insert on table public.activities to authenticated;
grant insert, delete on table public.follows to authenticated;
grant insert, delete on table public.likes to authenticated;
grant insert, update, delete on table public.comments to authenticated;

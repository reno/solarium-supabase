-- Data API privileges — the whole surface, in one file.
--
-- Tables created in `public` are not auto-exposed to the Data API roles (auto_expose_new_tables
-- is off in config.toml), so access is granted explicitly here. RLS, enabled on every table,
-- still decides which *rows* a role may touch; these grants only open the table-level door and,
-- in three cases, narrow it to a column list.
--
-- The column lists are the load-bearing part. A row policy says which rows you may update; only
-- a column grant says which columns may change. Widening any of the three below to a plain
-- `grant update on <table> to authenticated` would silently re-open what it was written to shut.

grant usage on schema public to anon, authenticated, service_role;

-- Settlement and mint recording run in edge functions with the service role.
grant all on all tables in schema public to service_role;
grant all on all routines in schema public to service_role;
-- ...and keep covering anything added later, instead of re-granting by hand each time.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on routines to service_role;

-- ---------------------------------------------------------------------------
-- Reads: everything is public (marketplace + social feeds).
-- ---------------------------------------------------------------------------

grant select on table
  public.profiles,
  public.collections,
  public.nfts,
  public.listings,
  public.activities,
  public.offers,
  public.mint_phases,
  public.launchpad_allowlist,
  public.candy_machines,
  public.follows,
  public.likes,
  public.comments,
  public.nft_like_counts,
  public.profile_follow_counts,
  public.collection_market_stats
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Writes. RLS policies scope each to the caller's own rows.
-- ---------------------------------------------------------------------------

grant insert, update on table public.profiles to authenticated;

-- collections: NOT a table-level update grant. `verified` is the vetting badge — with a
-- table-level grant any creator could set it on their own collection through PostgREST and
-- self-award it. `royalty_bps` is the settlement split and is only ever written at insert
-- time; add it back here if an edit-royalty UI is ever built.
grant insert on table public.collections to authenticated;
grant update (name, description, cover_url, banner_url, reveal_at, collection_address)
  on table public.collections to authenticated;

-- nfts: creators record their own mints, and may write the two derived rarity columns (see
-- recompute_collection_rarity). `owner_id` is deliberately absent — settlement remains the only
-- thing that can move an asset.
grant insert on table public.nfts to authenticated;
grant update (rarity_rank, rarity_total) on table public.nfts to authenticated;

-- listings: sellers may cancel or reprice. `buyer_id` and `sale_tx` belong to settlement.
grant insert on table public.listings to authenticated;
grant update (status, price_lamports, expires_at) on table public.listings to authenticated;

grant insert on table public.activities to authenticated;
grant insert, update on table public.offers to authenticated;
grant insert, update, delete on table public.mint_phases to authenticated;
grant insert, delete on table public.launchpad_allowlist to authenticated;
grant insert, update on table public.candy_machines to authenticated;
grant insert, delete on table public.follows to authenticated;
grant insert, delete on table public.likes to authenticated;
grant insert, update, delete on table public.comments to authenticated;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

grant execute on function public.recompute_collection_rarity(uuid) to authenticated, service_role;

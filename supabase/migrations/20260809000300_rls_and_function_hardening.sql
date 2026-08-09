-- RLS and function hardening.
--
-- Three unrelated-looking items that share a cause: Postgres defaults that the schema never
-- overrode. RLS applies to everyone *except* the table owner unless forced; new functions are
-- executable by PUBLIC unless revoked; and a function without a pinned search_path resolves
-- unqualified names against whatever the caller's search_path happens to be.

-- ---------------------------------------------------------------------------
-- Force RLS
-- ---------------------------------------------------------------------------
-- Honest scope note: in this project both `postgres` and `service_role` carry BYPASSRLS, so
-- forcing changes nothing for them — a role with BYPASSRLS ignores RLS whether or not it is
-- forced, and the edge functions (service_role) keep working exactly as before. What this buys
-- is that policies stop being silently inert for any *other* role that ends up owning these
-- tables: a future migration role, a restore, a role created without BYPASSRLS. It costs
-- nothing and removes a footgun rather than closing an open door.

alter table public.profiles               force row level security;
alter table public.collections            force row level security;
alter table public.nfts                   force row level security;
alter table public.listings               force row level security;
alter table public.activities             force row level security;
alter table public.offers                 force row level security;
alter table public.mint_phases            force row level security;
alter table public.launchpad_allowlist    force row level security;
alter table public.candy_machines         force row level security;
alter table public.follows                force row level security;
alter table public.likes                  force row level security;
alter table public.comments               force row level security;
alter table public.collection_item_rarity force row level security;
alter table public.settlement_intents     force row level security;

-- ---------------------------------------------------------------------------
-- Pin search_path on the remaining functions
-- ---------------------------------------------------------------------------
-- handle_new_user already does this correctly. These two did not, which is what the Supabase
-- linter's function_search_path_mutable warning was pointing at. Neither is SECURITY DEFINER
-- today, so neither was a privilege-escalation route on its own — the point is that adding
-- `security definer` to one later would silently make it into one.
--
-- Both bodies already schema-qualify everything they touch, so pinning the path is inert
-- beyond removing that trap. pg_catalog stays implicitly available, so the built-ins each of
-- them relies on still resolve.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.recompute_collection_rarity(p_collection uuid)
returns void
language sql
set search_path = ''
as $$
  with expanded as (
    select n.id as nft_id, t.obj->>'trait' as trait, t.obj->>'value' as value
    from public.nfts n
    cross join lateral jsonb_array_elements(n.traits) as t(obj)
    where n.collection_id = p_collection
  ),
  freq as (
    select trait, value,
           count(*)::numeric as cnt,
           sum(count(*)) over (partition by trait) as trait_total
    from expanded
    group by trait, value
  ),
  scored as (
    select n.id as nft_id, coalesce(sum(f.trait_total / f.cnt), 0) as score
    from public.nfts n
    left join expanded e on e.nft_id = n.id
    left join freq f on f.trait = e.trait and f.value = e.value
    where n.collection_id = p_collection
    group by n.id
  ),
  ranked as (
    select nft_id,
           row_number() over (order by score desc, nft_id) as rnk,
           count(*) over () as tot,
           -- Any traits anywhere in this collection? If not, rarity is not a real quantity here.
           exists (select 1 from expanded) as rankable
    from scored
  )
  update public.nfts n
  set rarity_rank = case when r.rankable then r.rnk::int end,
      rarity_total = case when r.rankable then r.tot::int end
  from ranked r
  where r.nft_id = n.id;
$$;

-- ---------------------------------------------------------------------------
-- Execute privileges
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE on every new function to PUBLIC. 20260808001200_grants.sql granted
-- execute to `authenticated, service_role` explicitly, which read as if it were narrowing the
-- surface — it was not, because it never revoked the default. Everything in `public` is exposed
-- by PostgREST as /rest/v1/rpc/<name>.

-- handle_new_user is a SECURITY DEFINER trigger function; it has no business being callable
-- over HTTP by anyone. (Called directly it errors on the missing trigger context rather than
-- doing damage, but a definer function reachable by `anon` is not a thing to leave lying around.)
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- recompute_collection_rarity is invoker-rights and now has no caller outside the edge
-- functions: no app code calls .rpc() at all, and `authenticated` no longer holds the UPDATE
-- grant on nfts that used to make a creator-initiated re-rank meaningful. Left reachable it is
-- a free unauthenticated full-collection scan that only fails *after* doing the work.
revoke execute on function public.recompute_collection_rarity(uuid) from public, anon, authenticated;
grant execute on function public.recompute_collection_rarity(uuid) to service_role;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.enforce_offer_expiry() from public, anon, authenticated;

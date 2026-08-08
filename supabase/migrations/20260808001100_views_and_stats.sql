-- Derived reads: count views, live market stats, and rarity.
--
-- Everything here is computed from data the app already stores. Nothing is cached in a column:
-- a windowed figure ("volume in the last 24h", "vs. the previous 24h") is wrong the moment the
-- window slides even if nothing traded, so all of it is computed on read.

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
-- collection_market_stats — every trending number the home page renders.
--
-- volume_prev_24h exists so the caller can compute the 24h delta per request rather than
-- reading a cached one. `sparkline` is the last 14 days of daily sale volume in SOL, oldest →
-- newest, and replaces what used to be a stored collections.stat_sparkline column kept fresh by
-- a refresh function the mint and settlement flows had to remember to call.
-- ---------------------------------------------------------------------------

create view public.collection_market_stats
with (security_invoker = true) as
  select
    c.id as collection_id,
    coalesce(sum(a.lamports) filter (where a.type = 'sale'), 0)::bigint as volume_all,
    coalesce(sum(a.lamports) filter (where a.type = 'sale' and a.created_at >= now() - interval '24 hours'), 0)::bigint as volume_24h,
    coalesce(sum(a.lamports) filter (where a.type = 'sale' and a.created_at >= now() - interval '7 days'), 0)::bigint as volume_7d,
    coalesce(sum(a.lamports) filter (where a.type = 'sale' and a.created_at >= now() - interval '30 days'), 0)::bigint as volume_30d,
    count(*) filter (where a.type = 'sale') as sales_count,
    coalesce(sum(a.lamports) filter (where a.type = 'sale' and a.created_at >= now() - interval '48 hours' and a.created_at < now() - interval '24 hours'), 0)::bigint as volume_prev_24h,
    (
      select coalesce(jsonb_agg(round(d.day_vol, 3) order by d.day), '[]'::jsonb)
      from (
        select gs.day,
          coalesce((
            select sum(a3.lamports)::numeric / 1e9
            from public.activities a3
            join public.nfts n3 on n3.id = a3.nft_id
            where n3.collection_id = c.id and a3.type = 'sale'
              and date_trunc('day', a3.created_at) = gs.day
          ), 0) as day_vol
        from generate_series(
          date_trunc('day', now()) - interval '13 days',
          date_trunc('day', now()),
          interval '1 day'
        ) as gs(day)
      ) d
    ) as sparkline
  from public.collections c
  left join public.nfts n on n.collection_id = c.id
  left join public.activities a on a.nft_id = n.id
  group by c.id;

-- ---------------------------------------------------------------------------
-- Rarity: score each item by how uncommon its trait values are in its collection.
--   score  = Σ over traits (values_seen_in_trait / times_this_value_appears)
--   rarest = highest score = rank 1. rarity_total = items in the collection.
--
-- A collection whose items carry no traits has no rarity to rank, so leave rank/total null
-- rather than handing out row-number ranks that would render as a confident "Rank 3 / 10"
-- derived from nothing.
--
-- Invoker rights on purpose: RLS is the authorization. The candy-mint edge function calls this
-- as service_role after recording a mint; a creator may also call it for their own collection,
-- which the column-level UPDATE grant on nfts is what makes safe.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_collection_rarity(p_collection uuid)
returns void
language sql
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

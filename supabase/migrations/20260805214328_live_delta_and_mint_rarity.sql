-- Two fixes to derived display data:
--
--   1. 24h delta computed on read. A "vs. the previous 24h" figure goes stale with the clock,
--      not with the data — a cached `stat_delta_bps` is wrong the moment the window slides, even
--      if nothing traded. Exposing the previous window on the live view lets the home page
--      compute it per request. (`collections.stat_delta_bps` is still maintained by
--      refresh_collection_stats but no longer read by the app; it's a drop candidate.)
--
--   2. Rarity on mint. `recompute_collection_rarity` only ever ran from seed.sql, so items minted
--      in-app never got a rank. The mint flow now calls it — which needs the creator to be able to
--      write the two derived columns, without opening up `nfts` in general.

-- ---------------------------------------------------------------------------
-- 1. Previous-24h window, for a delta that is never stale.
--    New column goes last so `create or replace view` accepts it.
-- ---------------------------------------------------------------------------

create or replace view public.collection_market_stats
with (security_invoker = true) as
  select
    c.id as collection_id,
    coalesce(sum(a.lamports) filter (where a.type = 'sale'), 0)::bigint as volume_all,
    coalesce(sum(a.lamports) filter (where a.type = 'sale' and a.created_at >= now() - interval '24 hours'), 0)::bigint as volume_24h,
    coalesce(sum(a.lamports) filter (where a.type = 'sale' and a.created_at >= now() - interval '7 days'), 0)::bigint as volume_7d,
    coalesce(sum(a.lamports) filter (where a.type = 'sale' and a.created_at >= now() - interval '30 days'), 0)::bigint as volume_30d,
    count(*) filter (where a.type = 'sale') as sales_count,
    coalesce(sum(a.lamports) filter (where a.type = 'sale' and a.created_at >= now() - interval '48 hours' and a.created_at < now() - interval '24 hours'), 0)::bigint as volume_prev_24h
  from public.collections c
  left join public.nfts n on n.collection_id = c.id
  left join public.activities a on a.nft_id = n.id
  group by c.id;

-- ---------------------------------------------------------------------------
-- 2. Rarity: score only where there is something to score, and let creators
--    recompute their own collection.
-- ---------------------------------------------------------------------------

-- Same scoring as before, with one addition: a collection whose items carry no traits has no
-- rarity to rank, so leave rank/total null rather than handing out row-number ranks that would
-- render as a confident "Rank 3 / 10" derived from nothing. (The in-app quick mint records no
-- traits today; a real generative drop supplies them.)
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

-- The mint flow calls this client-side as the collection's creator. Rather than a SECURITY DEFINER
-- escape hatch, keep the function invoker-rights and widen `nfts` by the smallest possible amount:
-- a column-level grant (Postgres rejects an update touching any other column) plus a row policy
-- scoped to the caller's own mints. Ownership updates still have no path here — `owner_id` is not
-- in the grant, so settlement remains the only thing that can move an asset.
--
-- The column list is what makes this safe, not the policy. Never widen it to a table-level
-- `grant update on public.nfts to authenticated` — combined with the row policy below that would
-- hand every creator the ability to rewrite owner_id on their own mints.
grant update (rarity_rank, rarity_total) on public.nfts to authenticated;

create policy "creators can recompute rarity on their own items"
  on public.nfts for update
  using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);

grant execute on function public.recompute_collection_rarity(uuid) to authenticated;
